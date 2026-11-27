// 圧縮しない ZIP（アーティファクト上では GLB を直接保存できないため）
const TABLE=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
export const crc32=u=>{let c=0xffffffff;for(let i=0;i<u.length;i++)c=TABLE[(c^u[i])&255]^(c>>>8);return(c^0xffffffff)>>>0;};
export function zipOne(name,data){
  const n=new TextEncoder().encode(name),crc=crc32(data),local=30+n.length,central=46+n.length,out=new Uint8Array(local+data.length+central+22),dv=new DataView(out.buffer);
  const u16=(o,v)=>dv.setUint16(o,v,true),u32=(o,v)=>dv.setUint32(o,v,true);
  u32(0,0x04034b50);u16(4,20);u16(6,0x0800);u16(12,0x21);u32(14,crc);u32(18,data.length);u32(22,data.length);u16(26,n.length);out.set(n,30);out.set(data,local);
  const c=local+data.length;u32(c,0x02014b50);u16(c+4,20);u16(c+6,20);u16(c+8,0x0800);u16(c+14,0x21);u32(c+16,crc);u32(c+20,data.length);u32(c+24,data.length);u16(c+28,n.length);out.set(n,c+46);
  const e=c+central;u32(e,0x06054b50);u16(e+8,1);u16(e+10,1);u32(e+12,central);u32(e+16,c);
  return out;
}
