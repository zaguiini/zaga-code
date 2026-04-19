type RunImageInput = {
  name: string
  url: string
  mimeType: string
}

export async function fileToDataUrl(file: File): Promise<RunImageInput> {
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error(`Failed to read ${file.name}`))
    }
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}`))
    reader.readAsDataURL(file)
  })

  return {
    name: file.name,
    url,
    mimeType: file.type,
  }
}
