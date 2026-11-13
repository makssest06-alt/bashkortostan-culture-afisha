'use client';

/**
 * WebGL-часть жетона. Подгружается динамически из TokenCanvas.tsx (без SSR).
 *
 * Камера перспективная с узким углом (20°): искажение почти незаметно, но у кувырка есть глубина.
 * Поза из долей окна переводится в мировые координаты через viewport плоскости z = 0:
 *   position.x =  pose.x * viewport.width
 *   position.y = -pose.y * viewport.height
 *   scale      =  pose.scale * viewport.width   (жетон имеет диаметр 1)
 * Центр жетона и его диаметр при виде анфас совпадают с позой точно.
 *
 * Кадры рисуются по требованию: пока поза не меняется и жетон догнал цель, холст простаивает.
 */

import { Environment, Lightformer } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useRef, useState } from 'react';
import type { Group } from 'three';
import { MathUtils } from 'three';

import Token from '@/components/three/Token';

import { getSceneEnv, subscribeEnv } from './env';
import { getTokenPose, subscribe } from './store';

/** Скорость догона позы: больше значение, жёстче привязка к прокрутке. */
const FOLLOW = 14;
const MAX_DELTA = 1 / 30;
const EPSILON = 0.0005;

type Mode = 'solid' | 'wire';

function TokenRig() {
  const group = useRef<Group>(null);
  const pose = useRef({ x: 0, y: 0, scale: 0.24, rx: 0, ry: 0, rz: 0, opacity: 0, started: false });
  const modeRef = useRef<Mode>('solid');
  const [mode, setMode] = useState<Mode>('solid');
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const request = () => invalidate();
    const offStore = subscribe(request);
    const offEnv = subscribeEnv(request);
    request();
    return () => {
      offStore();
      offEnv();
    };
  }, [invalidate]);

  useFrame((state, delta) => {
    const node = group.current;
    if (!node) return;

    const target = getTokenPose(getSceneEnv());
    const current = pose.current;
    const dt = Math.min(delta, MAX_DELTA);

    if (!current.started) {
      // Первый кадр: жетон сразу на месте, без прилёта из угла.
      Object.assign(current, target, { started: true });
    } else {
      current.x = MathUtils.damp(current.x, target.x, FOLLOW, dt);
      current.y = MathUtils.damp(current.y, target.y, FOLLOW, dt);
      current.scale = MathUtils.damp(current.scale, target.scale, FOLLOW, dt);
      current.rx = MathUtils.damp(current.rx, target.rx, FOLLOW, dt);
      current.ry = MathUtils.damp(current.ry, target.ry, FOLLOW, dt);
      current.rz = MathUtils.damp(current.rz, target.rz, FOLLOW, dt);
      current.opacity = MathUtils.damp(current.opacity, target.opacity, FOLLOW, dt);
    }

    const { width, height } = state.viewport;
    node.position.set(current.x * width, -current.y * height, 0);
    node.scale.setScalar(Math.max(current.scale, 0.0001) * width);
    node.rotation.set(current.rx, current.ry, current.rz);
    node.visible = current.opacity > 0.004;
    // На холсте только жетон: прозрачность задаём всему холсту, материалы трогать не нужно.
    state.gl.domElement.style.opacity = current.opacity.toFixed(3);

    const nextMode: Mode = target.mode ?? 'solid';
    if (nextMode !== modeRef.current) {
      modeRef.current = nextMode;
      setMode(nextMode);
    }

    const settled =
      Math.abs(current.x - target.x) < EPSILON &&
      Math.abs(current.y - target.y) < EPSILON &&
      Math.abs(current.scale - target.scale) < EPSILON &&
      Math.abs(current.rx - target.rx) < EPSILON &&
      Math.abs(current.ry - target.ry) < EPSILON &&
      Math.abs(current.rz - target.rz) < EPSILON &&
      Math.abs(current.opacity - target.opacity) < EPSILON;
    if (!settled) state.invalidate();
  });

  return (
    <group ref={group}>
      <Token mode={mode} />
    </group>
  );
}

/**
 * Свет без внешних загрузок: окружение собрано из световых панелей и запекается один раз.
 * Жетон металлический, поэтому его вид это отражение панелей: при повороте блики бегут по рельефу.
 * Панели стоят вокруг начала координат (жетон), камера смотрит с +Z.
 */
function Lights() {
  return (
    <Suspense fallback={null}>
      <Environment resolution={256} frames={1}>
        {/* Тёплая темнота вместо чёрного: металл в тени уходит в глубокий коричневый */}
        <color attach="background" args={['#120a06']} />
        {/* Ключевой: тёплый, слева снизу. Большой: оборот горит всё время, пока поворачивается к зрителю */}
        <Lightformer form="rect" color="#FFB37E" intensity={5} position={[-7, -3, 1.5]} scale={[8, 8, 1]} />
        {/* Цвет свечения сайта: насыщенное ядро ключевого, ближе к камере */}
        <Lightformer form="rect" color="#E57C4E" intensity={5} position={[-5, -4.5, 3.5]} scale={[5, 5, 1]} />
        {/* Заполняющий: кремовый экран за камерой, смещён к ключевому; по нему читается лицо анфас */}
        <Lightformer form="rect" color="#FFE2C4" intensity={0.9} position={[-2.5, -2, 9]} scale={[10, 8, 1]} />
        {/* Лампа у камеры: мягкое горячее пятно на лице, вспышка на полированных выпуклостях */}
        <Lightformer form="circle" color="#FEFDBD" intensity={4.5} position={[-1, -0.8, 9]} scale={2.2} />
        {/* Контровой: холодноватый, сверху справа */}
        <Lightformer form="rect" color="#D5E4FF" intensity={5} position={[6, 4.5, 0.5]} scale={[1.8, 9, 1]} />
        {/* Верхний софтбокс: лицо вспыхивает, когда жетон ложится после кувырка через горизонталь */}
        <Lightformer form="rect" color="#FFE9CF" intensity={3.5} position={[0.5, 7, 3.5]} scale={[10, 4, 1]} />
        {/* Отсвет снизу, как от стола: лицо не гаснет, когда наклонено вниз */}
        <Lightformer form="rect" color="#F6C29C" intensity={1.3} position={[0.5, -8, 2]} scale={[9, 2.5, 1]} />
      </Environment>
    </Suspense>
  );
}

export type TokenCanvasGLProps = {
  /** Потерян контекст WebGL или холст не создался: родитель покажет плоскую заглушку. */
  onFail: () => void;
};

/** Телефон или планшет: память GPU там общая с вкладкой, и браузер iPhone убивает страницу при её нехватке. */
function isHandheld(): boolean {
  return window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 768;
}

export default function TokenCanvasGL({ onFail }: TokenCanvasGLProps) {
  // Плотность 2 на телефоне сама сглаживает край, поэтому MSAA (вчетверо больше памяти кадра) там выключен.
  const handheld = isHandheld();
  return (
    <Canvas
      frameloop="demand"
      dpr={handheld ? [1, 1.75] : [1, 2]}
      camera={{ fov: 20, position: [0, 0, 10], near: 1, far: 40 }}
      gl={{ antialias: !handheld, alpha: true, powerPreference: handheld ? 'default' : 'high-performance' }}
      resize={{ scroll: false, debounce: { scroll: 0, resize: 0 } }}
      style={{ pointerEvents: 'none' }}
      onCreated={({ gl }) => {
        gl.domElement.style.opacity = '0';
        gl.domElement.addEventListener('webglcontextlost', onFail, { once: true });
      }}
    >
      <Lights />
      <TokenRig />
    </Canvas>
  );
}
