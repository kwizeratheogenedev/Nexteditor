// One-click color grading looks for the RightPanel Color tab. Each preset
// is just a coordinated brightness/contrast/saturation/temperature
// combination - it reuses the exact same clip.filters 'color' entry (and
// therefore the exact same preview/export pipeline) that the manual sliders
// already write to, so no new filter type or backend work is needed here.
export const COLOR_PRESETS = [
  { id: 'none', label: 'None', swatch: 'linear-gradient(135deg, #6b7280, #9ca3af)', params: { brightness: 0, contrast: 0, saturation: 0, temperature: 0 } },
  { id: 'cinematic', label: 'Cinematic', swatch: 'linear-gradient(135deg, #0f2027, #2c5364)', params: { brightness: -5, contrast: 25, saturation: -15, temperature: -10 } },
  { id: 'vivid', label: 'Vivid', swatch: 'linear-gradient(135deg, #ff512f, #f09819)', params: { brightness: 5, contrast: 20, saturation: 35, temperature: 5 } },
  { id: 'warm', label: 'Warm', swatch: 'linear-gradient(135deg, #f6d365, #fda085)', params: { brightness: 5, contrast: 5, saturation: 10, temperature: 35 } },
  { id: 'cool', label: 'Cool', swatch: 'linear-gradient(135deg, #2980b9, #6dd5fa)', params: { brightness: 0, contrast: 5, saturation: 5, temperature: -35 } },
  { id: 'noir', label: 'B&W', swatch: 'linear-gradient(135deg, #232526, #e0e0e0)', params: { brightness: -5, contrast: 30, saturation: -100, temperature: 0 } },
  { id: 'vintage', label: 'Vintage', swatch: 'linear-gradient(135deg, #a8763e, #d9c48f)', params: { brightness: -10, contrast: -10, saturation: -25, temperature: 20 } },
];

export function findMatchingPresetId(params) {
  const match = COLOR_PRESETS.find((preset) => (
    preset.params.brightness === (params?.brightness || 0)
    && preset.params.contrast === (params?.contrast || 0)
    && preset.params.saturation === (params?.saturation || 0)
    && preset.params.temperature === (params?.temperature || 0)
  ));
  return match?.id || null;
}
