import json,hashlib,argparse
from pathlib import Path
import dnfile
parser=argparse.ArgumentParser();parser.add_argument('root',type=Path);root=parser.parse_args().root;path=root/'Newtonsoft.Json.dll'
pe=dnfile.dnPE(str(path));assert pe.net is not None
counts={name:len(getattr(pe.net.mdtables,name).rows) if getattr(pe.net.mdtables,name,None) else 0 for name in ['TypeDef','MethodDef','MemberRef','Field','Property','Event','Param','StandAloneSig','TypeSpec','ExportedType']}
selected=[]
for index,row in enumerate(pe.net.mdtables.TypeDef.rows,1):
 name=(str(row.TypeNamespace)+'.' if str(row.TypeNamespace) else '')+str(row.TypeName)
 if name!='Newtonsoft.Json.JsonConvert':continue
 selected.append({'token':f'0x{0x02000000|index:08x}','name':name,'methods':[{'token':f'0x{0x06000000|m.row_index:08x}','name':str(m.row.Name),'rva':m.row.Rva,'signature_hex':m.row.Signature.value.hex()} for m in row.MethodList]})
assert len(selected)==1
refs=[{'token':f'0x{0x0a000000|i:08x}','name':str(row.Name),'signature_hex':row.Signature.value.hex()} for i,row in enumerate(pe.net.mdtables.MemberRef.rows[:16],1)]
assembly=pe.net.mdtables.Assembly.rows[0]
oracle={'decoder':'dnfile==0.18.0 (independent Python PE/CLI parser)','assembly_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'assembly_name':str(assembly.Name),'assembly_version':'.'.join(str(getattr(assembly,k)) for k in ['MajorVersion','MinorVersion','BuildNumber','RevisionNumber']),'row_counts':counts,'selected_types':selected,'member_refs_first_16':refs,'target_execution':False}
(root/'oracle.json').write_text(json.dumps(oracle,indent=2)+'\n')
print(json.dumps({'assembly':oracle['assembly_name'],'version':oracle['assembly_version'],'row_counts':counts,'selected_type':selected[0]['name'],'selected_methods':len(selected[0]['methods']),'target_execution':False}))
pe.close()
