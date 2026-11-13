/**
 * Единая точка входа GSAP. Импортируйте gsap, ScrollTrigger и useGSAP только отсюда:
 * так плагины гарантированно зарегистрированы один раз, до первого использования.
 *
 *   import { gsap, ScrollTrigger, useGSAP } from '@/lib/gsap';
 *
 * Регистрация безопасна на сервере: без window ScrollTrigger не включается.
 */

import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger, useGSAP);

if (typeof window !== 'undefined') {
  // Панель адреса на телефоне прячется и появляется: пересчитывать закрепления из-за этого не нужно.
  ScrollTrigger.config({ ignoreMobileResize: true });
}

export { gsap, ScrollTrigger, useGSAP };
