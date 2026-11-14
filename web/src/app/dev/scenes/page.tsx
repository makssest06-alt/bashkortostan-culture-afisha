import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { HomeStage } from '@/components/home/HomeStage';

/**
 * Проверка сцен главной отдельно от соседей: /dev/scenes?only=gallery,fullscreen
 * Нужна при параллельной работе над сценами: ошибка в чужой сцене не ломает предпросмотр своей.
 * В индекс не попадает.
 */
export const metadata: Metadata = { title: 'Сцены: предпросмотр', robots: { index: false, follow: false } };

export default async function DevScenesPage({
  searchParams,
}: {
  searchParams: Promise<{ only?: string }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { only } = await searchParams;
  const ids = (only ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return <HomeStage only={ids} />;
}
