from pathlib import Path
import json,re,hashlib,argparse
parser=argparse.ArgumentParser(description='Match every native instruction byte against independently mapped ELF file ranges');parser.add_argument('--root',type=Path,required=True);args=parser.parse_args();lab=args.root;oracle=json.loads((lab/'elf-oracle.json').read_text());image=Path(oracle['path']).read_bytes();assert hashlib.sha256(image).hexdigest()==oracle['artifact_sha256'];rows=[]
for directory in sorted(lab.iterdir()):
 bundle=directory/'evidence.json'
 if not bundle.is_file():continue
 for parent in json.loads(bundle.read_text())['records']:
  if parent['operation'] not in ['gdb_console','inspect_with_objdump']:continue
  params=parent['parameters'];gdb=parent['operation']=='gdb_console'
  symbol=params.get('command','').removeprefix('disassemble /r ') if gdb else params.get('symbol')
  if symbol not in {s['name'] for s in oracle['symbols']}:continue
  spec=next(s for s in oracle['symbols'] if s['name']==symbol)
  report=parent['normalized_result'];assert report['completion_status']=='complete' and not report['output_truncated']
  if gdb:
   assert parent['subject'] is None
   console='\n'.join(line for line in report['records'] if line.startswith('~'));assert console==report['console']
   text=''.join(json.loads(line[1:]) for line in report['records'] if line.startswith('~'))
   pattern=r'^\s*(?:=>\s*)?0x([0-9a-f]+)[^:]*:\s*((?:[0-9a-f]{2}(?:\s+|$))+)'
  else:
   assert parent['subject']['digest']['sha256']==oracle['artifact_sha256'];text=report['stdout'];pattern=r'^\s*([0-9a-f]+):\s*((?:[0-9a-f]{2}(?:\s+|$))+)'
  address=spec['address'];collected=bytearray();count=0
  for line in text.splitlines():
   m=re.match(pattern,line)
   if not m:continue
   actual=int(m[1],16);raw=bytes.fromhex(m[2]);assert actual==address+len(collected),(directory,actual,address+len(collected));collected.extend(raw);count+=1
  expected=image[spec['file_offset']:spec['file_offset']+spec['bytes']];assert collected==expected,(directory,len(collected),len(expected));rows.append({'case':directory.name,'mode':'gdb' if gdb else 'objdump','symbol':symbol,'byte_bearing_lines':count,'bytes':len(collected),'exact_file_bytes':True,'parent_evidence_id':parent['evidence_id']})
assert rows
(lab/'native-final-verification.json').write_text(json.dumps({'status':'passed','artifact_sha256':oracle['artifact_sha256'],'records':rows},indent=2)+'\n');print(json.dumps(rows))
