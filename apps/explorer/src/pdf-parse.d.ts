declare module 'pdf-parse' {
  type ParseResult = {
    text: string;
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    version: string;
  };
  const pdfParse: (data: Buffer | Uint8Array, options?: unknown) => Promise<ParseResult>;
  export default pdfParse;
}
