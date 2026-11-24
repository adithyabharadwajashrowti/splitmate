/**
 * Shrink a photo before sending it to the scanner: max 1600px, JPEG ~0.8.
 * A 5 MB phone photo becomes ~300 KB — faster upload and cheaper AI.
 * @returns {Promise<{mime:string, data:string, preview:string}>} base64 without the data: prefix
 */
export async function compressImage(file, maxSide = 1600, quality = 0.8) {
  const bitmap = await loadBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  return { mime: 'image/jpeg', data: dataUrl.split(',')[1], preview: dataUrl }
}

function loadBitmap(file) {
  if ('createImageBitmap' in window) return createImageBitmap(file)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not open that image'))
    img.src = URL.createObjectURL(file)
  })
}
