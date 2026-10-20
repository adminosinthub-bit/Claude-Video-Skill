// Общие для render.mjs и frame.mjs: размер кадра (пресеты, 4K, суперсэмплинг) и качество 3D (window.__E3D_OPTS).
//   --preset vertical|vertical-4k|horizontal-4k|…  4K-пресеты = вёрстка 1080p × масштаб 2 (2160×3840 / 3840×2160)
//   --width W --height H     размер вёрстки в CSS-пикселях (vw/vh считаются от него)
//   --scale N                пикселей на CSS-пиксель (deviceScaleFactor): 2 → 4K при той же вёрстке; 3D рендерится в devicePixelRatio
//   --ss N                   суперсэмплинг: снять в N раз крупнее и сжать lanczos до итогового размера — идеально гладкие края
//   --ultra                  3D в качестве ultra (тени 4096, AO, плотная геометрия) — для финала; --draft3d — черновик
//   --ao / --no-ao           принудительно включить/выключить ambient occlusion во всех 3D-сценах
export const PRESETS = {
  vertical: [1080, 1920],
  'vertical-preview': [540, 960],
  'vertical-4k': [1080, 1920, 2],
  horizontal: [1920, 1080],
  'horizontal-preview': [960, 540],
  'horizontal-4k': [1920, 1080, 2],
  square: [1080, 1080],
  'square-4k': [1080, 1080, 2],
};

export function frameOpts(opt, has, def = 'horizontal') {
  const p = PRESETS[opt('preset', '')] || PRESETS[def];
  const width = parseInt(opt('width', p[0]), 10), height = parseInt(opt('height', p[1]), 10);
  const scale = parseFloat(opt('scale', p[2] || 1));
  const ss = Math.max(1, parseInt(opt('ss', '1'), 10));
  // итоговый размер — чётный (yuv420p)
  const even = (x) => Math.round(x / 2) * 2;
  const e3d = {
    ...(has('draft3d') ? { quality: 'draft' } : has('ultra') || has('max') ? { quality: 'ultra' } : {}),
    ...(has('ao') ? { ao: true } : has('no-ao') ? { ao: false } : {}),
  };
  return { width, height, scale, ss, dsf: scale * ss, outW: even(width * scale), outH: even(height * scale), e3d: Object.keys(e3d).length ? e3d : null };
}
