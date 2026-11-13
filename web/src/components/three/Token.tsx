'use client';

/**
 * Жетон-тәңкә: медный диск с бортиком, фаской и насечкой по гурту.
 * Лицо: кольцо кускара и курай. Оборот: «АФИША» по дуге и 102.
 *
 * Контракт (на него опирается TokenCanvas):
 *   - экспорт по умолчанию <Token mode />, mode: 'solid' (медь) или 'wire' (чертёж);
 *   - диаметр ровно 1 в локальных единицах, центр в начале координат;
 *   - при нулевых поворотах лицевая сторона смотрит на камеру (ось +Z), оборот смотрит в -Z;
 *   - надпись на обороте читается прямо, когда жетон повёрнут вокруг вертикальной оси (ry = π);
 *   - положение, масштаб, повороты и прозрачность задаёт TokenCanvas по позе сцены: сам жетон их не трогает.
 *
 * Устройство:
 *   - форма одна геометрия вращения (token/geometry.ts), две группы: лицо и оборот;
 *   - чеканка из карт высот /ornament/token-height*.png считается один раз (token/relief.ts):
 *     карта нормалей, цвет меди и шероховатость; пока карты считаются, жетон не рисуется;
 *   - свет живёт в TokenCanvasGL (окружение из световых панелей), здесь только материалы;
 *   - собственного движения нет: кадры рисуются по требованию холста, useFrame не нужен.
 */

import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';

import { ASSET_TOKEN, markAssetReady } from '@/components/home/preload';
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  GreaterDepth,
  LinearFilter,
  LinearMipmapLinearFilter,
  LineBasicMaterial,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';
import type { ColorSpace } from 'three';

import { buildOutlineSegments, buildTokenGeometry, contoursToSegments } from './token/geometry';
import { loadReliefSource } from './token/relief';
import type { ReliefSource, SideRelief } from './token/relief';

export type TokenProps = {
  mode?: 'solid' | 'wire';
};

/** Медь без чеканки: запасной вид, если карты высот не загрузились. */
const COPPER = '#D77241';
/** Линии чертежа: светлый тёплый, как текст сайта на тёмном. */
const WIRE = '#EFE6D8';

type SideMaps = { normal: DataTexture; color: DataTexture; rough: DataTexture };
type ReliefMaps = { front: SideMaps; back: SideMaps };
type Relief =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; maps: ReliefMaps; source: ReliefSource };

function dataTexture(data: Uint8Array, size: number, colorSpace: ColorSpace, anisotropy: number): DataTexture {
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.colorSpace = colorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

function sideMaps(side: SideRelief, anisotropy: number): SideMaps {
  return {
    normal: dataTexture(side.normal, side.size, NoColorSpace, anisotropy),
    color: dataTexture(side.color, side.surfaceSize, SRGBColorSpace, anisotropy),
    rough: dataTexture(side.rough, side.surfaceSize, NoColorSpace, anisotropy),
  };
}

function disposeMaps(maps: ReliefMaps): void {
  for (const side of [maps.front, maps.back]) {
    side.normal.dispose();
    side.color.dispose();
    side.rough.dispose();
  }
}

/** Чеканка: считается после монтирования, текстуры живут вместе с компонентом. */
function useRelief(): Relief {
  const gl = useThree((state) => state.gl);
  const [relief, setRelief] = useState<Relief>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    let maps: ReliefMaps | null = null;
    // Телефону хватает карты 512: жетон там до 680 физических пикселей, растяжение не больше 1,35,
    // а края рельефа в карте высот и так мягкие. Счёт карт при этом вчетверо короче.
    const size = Math.min(window.innerWidth < 768 ? 512 : 1024, gl.capabilities.maxTextureSize);
    // Анизотропия 4: рельеф не мылится в наклоне, а выборок втрое меньше, чем при максимуме.
    const anisotropy = Math.min(4, gl.capabilities.getMaxAnisotropy());

    loadReliefSource(size).then(
      (source) => {
        if (!alive) return;
        maps = { front: sideMaps(source.front, anisotropy), back: sideMaps(source.back, anisotropy) };
        setRelief({ status: 'ready', maps, source });
        markAssetReady(ASSET_TOKEN);
      },
      (error: unknown) => {
        if (!alive) return;
        if (process.env.NODE_ENV !== 'production') console.warn('[token] карты высот не загрузились', error);
        setRelief({ status: 'failed' });
        markAssetReady(ASSET_TOKEN);
      },
    );

    return () => {
      alive = false;
      if (maps) disposeMaps(maps);
    };
  }, [gl]);

  return relief;
}

function copperMaterial(maps: SideMaps | null): MeshStandardMaterial {
  if (!maps) return new MeshStandardMaterial({ color: COPPER, metalness: 0.95, roughness: 0.4, dithering: true });
  return new MeshStandardMaterial({
    // Три выборки на пиксель: цвет, нормаль, шероховатость. Затенение впадин запечено в цвет.
    map: maps.color,
    normalMap: maps.normal,
    roughnessMap: maps.rough,
    roughness: 1,
    metalness: 1,
    dithering: true,
  });
}

function TokenWire({ geometry, relief }: { geometry: BufferGeometry; relief: Relief }) {
  const source = relief.status === 'ready' ? relief.source : null;

  const lines = useMemo(() => {
    const parts = [buildOutlineSegments()];
    if (source) {
      parts.push(contoursToSegments(source.front.contours, 1), contoursToSegments(source.back.contours, -1));
    }
    const positions = new Float32Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      positions.set(part, offset);
      offset += part.length;
    }
    const lineGeometry = new BufferGeometry();
    lineGeometry.setAttribute('position', new BufferAttribute(positions, 3));
    return lineGeometry;
  }, [source]);

  const materials = useMemo(
    () => ({
      // Тело пишет только глубину: по ней линии делятся на видимые и скрытые за телом.
      depth: new MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 }),
      hidden: new LineBasicMaterial({ color: WIRE, transparent: true, opacity: 0.2, depthFunc: GreaterDepth, depthWrite: false }),
      visible: new LineBasicMaterial({ color: WIRE, transparent: true, opacity: 0.92, depthWrite: false }),
      tint: new MeshBasicMaterial({ color: WIRE, transparent: true, opacity: 0.085, depthWrite: false }),
    }),
    [],
  );

  useEffect(() => () => lines.dispose(), [lines]);
  useEffect(
    () => () => {
      for (const material of Object.values(materials)) material.dispose();
    },
    [materials],
  );

  return (
    <>
      <mesh geometry={geometry} material={materials.depth} />
      <lineSegments geometry={lines} material={materials.hidden} renderOrder={1} />
      <lineSegments geometry={lines} material={materials.visible} renderOrder={2} />
      <mesh geometry={geometry} material={materials.tint} renderOrder={3} />
    </>
  );
}

export default function Token({ mode = 'solid' }: TokenProps) {
  const geometry = useMemo(() => buildTokenGeometry(), []);
  const relief = useRelief();
  const maps = relief.status === 'ready' ? relief.maps : null;
  // Материалы меди живут всё время, пока жив жетон: смена режима на чертёж и обратно не пересобирает шейдер.
  const copper = useMemo(() => [copperMaterial(maps?.front ?? null), copperMaterial(maps?.back ?? null)], [maps]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(
    () => () => {
      for (const material of copper) material.dispose();
    },
    [copper],
  );

  if (mode === 'wire') return <TokenWire geometry={geometry} relief={relief} />;
  // Пока чеканка считается, жетон не показываем: иначе гладкий диск на глазах сменится рельефным.
  if (relief.status === 'loading') return null;
  return <mesh geometry={geometry} material={copper} />;
}
