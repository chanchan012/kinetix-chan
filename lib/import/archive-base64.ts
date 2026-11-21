export function archiveBase64(bytes:Uint8Array) {
  const chunks=[];
  for (let offset=0;offset<bytes.length;offset+=32_768) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset,offset+32_768)));
  }
  return btoa(chunks.join(""));
}
