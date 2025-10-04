interface CompressedFileData {
  filename: string;
  data: string; // base64 encoded string, compressed with gzip
  compression: string; // e.g., "gzip"
  original_size: number; // original size in bytes
}

interface FileData {
  filename: string;
  data: Blob; // decompressed file data as Blob
  original_size: number; // original size in bytes
}

async function decompressFileData(compressedFileData: CompressedFileData): Promise<FileData> {
  if (compressedFileData.compression !== 'gzip') {
    console.warn(`Unknown compression type: ${compressedFileData.compression}`);
    // decoding base64 to binary only,
    const binaryString = atob(compressedFileData.data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return {
      filename: compressedFileData.filename,
      data: new Blob([bytes]),
      original_size: bytes.length,
    };
  }

  try {
    /* Base64 decode */
    const binaryString = atob(compressedFileData.data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    /* Decompress */
    const decompressedData = await decompressWithStream(bytes);

    /* Create Blob from decompressed data */
    const blob = new Blob([decompressedData]);

    return {
      filename: compressedFileData.filename,
      data: blob,
      original_size: decompressedData.length,
    };
  } catch (error) {
    console.error('Error decompressing file data:', error);
    throw error;
  }
}

async function decompressWithStream(compressedData: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  // Check for DecompressionStream support
  if (!('DecompressionStream' in window)) {
    throw new Error('DecompressionStream is not supported in this browser.');
  }

  const ds = new DecompressionStream('gzip');

  const blob = new Blob([compressedData]);
  const compressedStream = blob.stream();

  const decompressedstream = compressedStream.pipeThrough(ds);
  const decompressedArrayBuffer = await new Response(decompressedstream).arrayBuffer();
  return new Uint8Array(decompressedArrayBuffer);
}


async function decompressString(base64CompressedString: string | null): Promise<string> {
  if (!base64CompressedString) return ""

  try {
    // Base64 decode
    const binaryString = atob(base64CompressedString);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Decompress
    const decompressed = await decompressWithStream(bytes);

    // Convert to string
    const decoder = new TextDecoder();
    return decoder.decode(decompressed);
  } catch (error) {
    console.error('Error decompressing string:', error);
    return '';
  }
}

export type { CompressedFileData, FileData };
export { decompressFileData, decompressString };
