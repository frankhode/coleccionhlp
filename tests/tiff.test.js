import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const vendor = await readFile(new URL('../assets/vendor/UTIF.js', import.meta.url), 'utf8');
const worker = await readFile(new URL('../assets/tiff-worker.js', import.meta.url), 'utf8');

// Minimal standard TIFF fixture; pixel bytes and metadata are independent inputs.
function tiff({ width = 2, height = 1, depth = 8, orientation = 1, compression = 1 } = {}) {
  const tags = [[256,4,1,width],[257,4,1,height],[258,3,3,146],[259,3,1,compression],
    [262,3,1,2],[273,4,1,152],[274,3,1,orientation],[277,3,1,3],[278,4,1,height],[279,4,1,6*(depth/8)],[284,3,1,1]];
  const buffer = new ArrayBuffer(152 + 6 * depth / 8), view = new DataView(buffer);
  view.setUint16(0,0x4949,true);view.setUint16(2,42,true);view.setUint32(4,8,true);view.setUint16(8,tags.length,true);
  tags.forEach(([tag,type,count,value],i)=>{
    const offset=10+12*i;
    view.setUint16(offset,tag,true);view.setUint16(offset+2,type,true);view.setUint32(offset+4,count,true);view.setUint32(offset+8,value,true);
  });
  for(let i=0;i<3;i++)view.setUint16(146+2*i,depth,true);
  if(depth===8)new Uint8Array(buffer,152).set([255,0,0,0,255,0]);
  else for(let i=0;i<6;i++)view.setUint16(152+2*i,[65535,0,0,0,65535,0][i],true);
  return new Blob([buffer]);
}

async function decode(file) {
  let result, pixels, transform;
  const context = vm.createContext({
    console: {log(){}}, importScripts(){}, Blob,
    ImageData: class { constructor(data,width,height){Object.assign(this,{data,width,height});} },
    async createImageBitmap(image){pixels=Array.from(image.data);return {close(){}};},
    OffscreenCanvas: class {
      constructor(width,height){Object.assign(this,{width,height});}
      getContext(){return {drawImage(){},setTransform(...values){transform=values;}};}
      async convertToBlob(){return new Blob(['preview'],{type:'image/webp'});}
    },
    postMessage(value){result=value;},
  });
  context.self=context;
  vm.runInContext(vendor,context);
  vm.runInContext(worker,context);
  await context.onmessage({data:{file,maxEdge:640,quality:0.7}});
  return {result,pixels,transform};
}

test('TIFF decoding preserves RGB pixels for 8- and 16-bit originals',async()=>{
  for(const depth of [8,16]){
    const {result,pixels}=await decode(tiff({depth}));
    assert.equal(result.error,undefined);
    assert.deepEqual(pixels,[255,0,0,255,0,255,0,255]);
    assert.equal(result.width,2);assert.equal(result.height,1);
  }
});

test('TIFF orientation is applied to output dimensions and drawing',async()=>{
  const {result,transform}=await decode(tiff({orientation:6}));
  assert.equal(result.width,1);assert.equal(result.height,2);
  assert.deepEqual(transform,[0,1,-1,0,1,0]);
});

test('huge dimensions and unsupported compression fail before allocating image pixels',async()=>{
  const huge=await decode(tiff({width:1_000_000,height:1_000_000}));
  assert.match(huge.result.error,/memoria/);assert.equal(huge.pixels,undefined);
  const unsupported=await decode(tiff({compression:50000}));
  assert.match(unsupported.result.error,/variante/);assert.equal(unsupported.pixels,undefined);
});
