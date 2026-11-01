import argparse, json, statistics
from pathlib import Path
import tiktoken
parser=argparse.ArgumentParser()
parser.add_argument('root', type=Path)
parser.add_argument('--pattern', default='paired-*')
parser.add_argument('--output', type=Path)
args=parser.parse_args()
root=args.root
enc=tiktoken.get_encoding('cl100k_base')
compact=lambda v: json.dumps(v,ensure_ascii=False,separators=(',',':'))
count=lambda v: len(enc.encode(v,disallowed_special=()))
results=[]
for case in sorted(root.glob(args.pattern)):
    if not case.is_dir(): continue
    report=json.loads((case/'report.json').read_text())
    assert report['status']=='observed' and report['cleanup_verified']
    scope=next(json.loads(line) for line in reversed(case.with_name(case.name+'.log').read_text().splitlines()) if line.startswith('{"resource_scope":'))
    observed=scope['payload_resource_observation']
    assert scope['abort'] is None and scope['payload_resource_observation_verified'] and observed['payload_cleanup_verified'] and observed['payload_exit_code']==0
    catalog=json.loads((case/'catalog.json').read_text())
    transcript=json.loads((case/'transcript.json').read_text())
    inputs=[{k: t[k] for k in ['name','description','inputSchema']} for t in catalog['tools']]
    arg=sum(count(compact({'name':r['name'],'arguments':r['arguments']})) for r in transcript)
    text=sum(count(b['text']) for r in transcript for b in r['reply']['content'] if b['type']=='text')
    results.append({'case':case.name,'mode':report['mode'],'output_schema_profile':report.get('output_schema_profile','full'),'runtime_revision':report['runtime_revision'],'runtime_worktree_status':report['runtime_worktree_status'],'token_estimates':{'input_catalog_once':count(compact(inputs)),'arguments':arg,'text_replies':text,'whole_task':count(compact(inputs))+arg+text},'actual_model_usage':None,'wall_seconds':scope['elapsed_seconds'],'cpu_seconds':observed['cpu_stat']['usage_usec']/1e6,'peak_process_family_bytes_including_page_cache':observed['memory_peak_bytes'],'calls':report['calls'],'retained_records':report['retained_records'],'proof':json.loads((case/'independent-proof.json').read_text()),'resource_events':observed['resource_events'],'cleanup_verified':True})
summary={}
for mode in ['complete','selected']:
    rows=[r for r in results if r['mode']==mode]
    summary[mode]={key:statistics.median(r[key] for r in rows) for key in ['wall_seconds','cpu_seconds','peak_process_family_bytes_including_page_cache']}
    summary[mode]['whole_task_tokens_estimated']=[r['token_estimates']['whole_task'] for r in rows]
out={'status':'passed','tokenizer':'cl100k_base, tiktoken 0.12.0; estimates only; one input catalog plus arguments plus MCP text replies; not actual model usage','cold_warm':'Fresh server process and isolated HOME each run; alternating complete/selected, selected/complete, complete/selected. OS page caches are warm/uncontrolled; not an OS-cold claim.','tarball_sha256':'f2517c466b50424b661a27e48039f15db7783e5822f46b5c7d39f20104ac67a9','preparation_scope':'Reference-source import is performed once outside these repeated SDK trials and reported separately. Both workflows use the explicit existing semantic cap of one for the static correspondence question; full semantic coverage is not claimed.','summary':summary,'runs':results}
(args.output or root/'costs.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(summary,indent=2))
