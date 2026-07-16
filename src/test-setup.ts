/**
 * Test environment shims.
 *
 * jsdom's Blob predates `Blob.prototype.arrayBuffer`, which every browser
 * the app targets has shipped for years and which `parseFile` uses to read
 * a dropped file. Polyfilling it here keeps the shim in the test
 * environment, where the gap actually is, rather than bending the product
 * code around a jsdom limitation.
 */
if (typeof Blob !== "undefined" && typeof Blob.prototype.arrayBuffer !== "function") {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}
