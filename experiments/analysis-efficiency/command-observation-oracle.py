from pathlib import Path
import struct,hashlib,json,argparse
parser=argparse.ArgumentParser(description='Independent ELF64 little-endian native-command byte oracle');parser.add_argument('--input',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args();path=args.input;b=path.read_bytes();assert b[:6]==b'\x7fELF\x02\x01'
shoff=struct.unpack_from('<Q',b,40)[0];entsize,n,strings=struct.unpack_from('<HHH',b,58)
assert entsize==64 and shoff+n*entsize<=len(b)
sections=[struct.unpack_from('<IIQQQQIIQQ',b,shoff+i*entsize) for i in range(n)]
rows=[]
for si,s in enumerate(sections):
 if s[1]!=11:continue
 text=sections[s[6]];names=b[text[4]:text[4]+text[5]]
 assert s[9]==24 and s[5]%s[9]==0
 for ordinal,off in enumerate(range(s[4],s[4]+s[5],24)):
  name,info,other,section,value,size=struct.unpack_from('<IBBHQQ',b,off)
  end=names.find(b'\0',name);assert end>=name
  if names[name:end] not in [b'execute_command',b'execute_command_internal'] or info&15!=2:continue
  target=sections[section];file_offset=target[4]+value-target[3]
  assert target[4]<=file_offset and file_offset+size<=target[4]+target[5]
  rows.append({'symbol_table_section':si,'symbol_ordinal':ordinal,'name':names[name:end].decode('ascii'),'address':value,'bytes':size,'file_offset':file_offset,'first_16_bytes_hex':b[file_offset:file_offset+16].hex()})
assert rows
result={'path':str(path),'artifact_sha256':hashlib.sha256(b).hexdigest(),'artifact_bytes':len(b),'elf_class':64,'byte_order':'little','elf_machine':struct.unpack_from('<H',b,18)[0],'symbols':rows,'scope':'Independent ELF64 little-endian dynamic symbol/section mapping; no target execution or REA parser.'}
args.output.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
