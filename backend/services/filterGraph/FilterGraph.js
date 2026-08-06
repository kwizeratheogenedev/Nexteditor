// Small builder around an ffmpeg -filter_complex string. Each call to
// addNode appends one "[in]...filter...[out]" fragment; build() joins them
// with ';' into the final string ffmpeg expects. Kept deliberately dumb (no
// dependency graph/validation) - callers are responsible for wiring labels
// consistently, same as hand-writing the string would require.
export class FilterGraph {
  constructor() {
    this._fragments = [];
    this._counter = 0;
  }

  // Generates a short, unique label for an intermediate stream.
  label(prefix = 'l') {
    this._counter += 1;
    return `${prefix}${this._counter}`;
  }

  // inputLabels/outputLabels may be a single label or an array of labels.
  // An empty inputLabels array is valid for source filters (e.g. `color=`,
  // `anullsrc=`) that take no stream input.
  addNode(filterExpr, inputLabels, outputLabels) {
    const ins = (Array.isArray(inputLabels) ? inputLabels : [inputLabels])
      .filter(Boolean)
      .map((label) => `[${label}]`)
      .join('');
    const outs = (Array.isArray(outputLabels) ? outputLabels : [outputLabels])
      .map((label) => `[${label}]`)
      .join('');
    this._fragments.push(`${ins}${filterExpr}${outs}`);
    return outputLabels;
  }

  build() {
    return this._fragments.join(';');
  }
}
