import { motionMarker } from "./motion.stylex";
import * as stylex from '@stylexjs/stylex';
const welcomeFinAnimation = stylex.keyframes({
  '0%': {
    transform: 'translateY(2px) rotate(-1.5deg)'
  },
  '100%': {
    transform: 'translateY(2px) rotate(-1.5deg)'
  },
  '50%': {
    transform: 'translateY(-3px) rotate(1deg)'
  }
});
export const styles = stylex.create({
  markSvg: {
    width: '82%',
    height: '82%',
    display: 'block',
    pointerEvents: 'none'
  },
  welcomeSvg: {
    width: '100%',
    height: '100%',
    display: 'block',
    pointerEvents: 'none'
  },
  shape: {
    transformBox: 'fill-box',
    transformOrigin: 'center'
  },
  gooeyImage: {
    width: '100%',
    height: '100%',
    display: 'block',
    objectFit: 'contain'
  },
  fin: {
    transformOrigin: '50% 100%',
    animationName: {
      "default": welcomeFinAnimation,
      "@media (prefers-reduced-motion: reduce)": "none !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "none !important"
    },
    animationDuration: {
      "default": '6.4s',
      "@media (prefers-reduced-motion: reduce)": "0s !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "0s !important"
    },
    animationDelay: {
      "default": '0s',
      "@media (prefers-reduced-motion: reduce)": "0s !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "0s !important"
    },
    animationTimingFunction: {
      "default": 'ease-in-out',
      "@media (prefers-reduced-motion: reduce)": "ease !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "ease !important"
    },
    animationIterationCount: {
      "default": 'infinite',
      "@media (prefers-reduced-motion: reduce)": "1 !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "1 !important"
    },
    animationDirection: {
      "default": 'normal',
      "@media (prefers-reduced-motion: reduce)": "normal !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "normal !important"
    },
    animationFillMode: {
      "default": 'none',
      "@media (prefers-reduced-motion: reduce)": "none !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "none !important"
    },
    animationPlayState: {
      "default": 'running',
      "@media (prefers-reduced-motion: reduce)": "running !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "running !important"
    }
  }
});
