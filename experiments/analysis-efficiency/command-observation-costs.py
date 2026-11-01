"""Count all actual client JSON inputs and preserve bounded family resource receipts."""
from pathlib import Path
import argparse, json, hashlib
import tiktoken
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root',type=Path,required=True)
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args();lab=args.root;enc=tiktoken.get_encoding('cl100k_base')
compact=lambda value:json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False)
count=lambda value:len(enc.encode(compact(value),disallowed_special=()))
def resources(root):
 scope=json.loads(Path(str(root)+'.log').read_text().splitlines()[-1]);o=scope['payload_resource_observation']
 assert scope['abort'] is None and scope['payload_resource_observation_verified'] and o['payload_exit_code']==0 and o['payload_cleanup_verified']
 for event in o['resource_events'].values():assert not any(event.values())
 return {'wall_seconds':scope['elapsed_seconds'],'cpu_seconds':o['cpu_stat']['usage_usec']/1e6,'family_peak_mib':o['memory_peak_bytes']/1048576,'payload_cleanup_verified':True,'final_whole_scope_counters_verified':scope['resource_counters_verified']}
wire=[];sdk=[]
for root in sorted(lab.glob('final-wire-*')):
 if not root.is_dir():continue
 report=json.loads((root/'report.json').read_text());requests=json.loads((root/'model-requests.json').read_text());assert report['status'] in ['passed','expected-incomplete-task'] and not report['cleanup_failures'] and report['appserver_exit_code']==0 and report['owned_scope_drain']['remaining_processes']==[]
 rows=[]
 for index,captured in enumerate(requests):
  body=captured['body'];namespace=[n for n in body.get('tools',[]) if n.get('type')=='namespace' and n.get('name')=='mcp__rea_audit'];compaction=not namespace
  if compaction:assert 'CONTEXT CHECKPOINT COMPACTION' in compact(body['input'][-1])
  else:assert len(namespace)==1 and len(namespace[0]['tools'])==210
  rows.append({'index':index+1,'kind':'compaction' if compaction else 'normal','whole_json_tokens_proxy':count(body),'rea_namespace_tokens_proxy':0 if not namespace else count(namespace[0]),'rea_function_count':0 if not namespace else len(namespace[0]['tools'])})
 wire.append({'case':root.name,'task_completed':report['task_completed'],'mode':report['mode'],'budget':report['observations']['tool_output_budget'],'requests':len(rows),'compactions':sum(r['kind']=='compaction' for r in rows),'whole_json_tokens_proxy':sum(r['whole_json_tokens_proxy'] for r in rows),'request_details':rows,**resources(root)})
for root in sorted(lab.glob('final-sdk-*')):
 if not root.is_dir():continue
 report=json.loads((root/'report.json').read_text());assert report['status']=='passed' and not report['cleanup_failures'] and not report['receipt_failures']
 sdk.append({'case':root.name,'provider':report['provider'],'symbol':report['symbol'],'detail':report['detail'],'warm':report['warm'],'tool_calls':len(report['calls']),'exported_bundle_bytes':(root/'evidence.json').stat().st_size,'disassembly_calls':[r for r in report['calls'] if r['phase'].startswith('disassembly:')],**resources(root)})
receipt={'measurement_scope':'Actual public SDK and Codex0.163 app-server with real GDB/BFD. Local deterministic SSE fixture and observed-ID checkpoint; no AI inference, model usage/quality/acceptance or billing claim. Whole compact JSON serialization tokens are proxies and include all schemas/replays/compaction. Incomplete default baseline is excluded from completed-workflow gains. Fresh processes have unflushed OS caches; warm SDK cases repeat the selected disassembly in the same server. Native target never executed.','tokenizer':{'package':tiktoken.__version__,'encoding':enc.name},'runtime_pins':{variant:{k:v for k,v in json.loads((lab/(variant+'-manifest.json')).read_text()).items() if k!='files'} for variant in ['baseline','candidate']},'native':json.loads((lab/'native-prerequisite-manifest.json').read_text()),'wire':wire,'sdk':sdk}
args.output.write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps({'wire':[{k:v for k,v in row.items() if k!='request_details'} for row in wire],'sdk':[{k:v for k,v in row.items() if k!='disassembly_calls'} for row in sdk]},indent=2))
