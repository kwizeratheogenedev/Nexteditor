import path from 'path';

// Validate that a file path is within one of the allowed directories, so a
// crafted `filePath`/`videoPath` request field can never point ffmpeg at an
// arbitrary file on disk.
export function validateFilePath(filePath, allowedBasePaths) {
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }
  const bases = Array.isArray(allowedBasePaths) ? allowedBasePaths : [allowedBasePaths];
  const resolvedPath = path.resolve(filePath);
  return bases.some((base) => {
    const resolvedBase = path.resolve(base);
    return resolvedPath.startsWith(resolvedBase) && resolvedPath !== resolvedBase;
  });
}

// Resolves the on-disk path for either a multer-uploaded file or a
// server-relative path already sitting in one of the allowed directories
// (e.g. a file fetched from a URL, or a prior job's output in clips/).
export function getFileSource(file, filePath, allowedBasePaths) {
  if (file) {
    if (typeof file.path === 'string' && file.path.length > 0) {
      if (!validateFilePath(file.path, allowedBasePaths)) {
        throw new Error('Invalid file path');
      }
      return file.path;
    }
    if (typeof file.destination === 'string' && typeof file.filename === 'string') {
      const constructed = path.join(file.destination, file.filename);
      if (!validateFilePath(constructed, allowedBasePaths)) {
        throw new Error('Invalid file path');
      }
      return constructed;
    }
  }
  if (filePath) {
    if (!validateFilePath(filePath, allowedBasePaths)) {
      throw new Error('Invalid file path');
    }
    return filePath;
  }
  return null;
}
