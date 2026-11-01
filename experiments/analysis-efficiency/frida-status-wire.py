"""Actual Codex wire capture with a deterministic local SSE backend; no AI inference."""
import argparse
import http.server
import threading
import asyncio
import hashlib
import json
import os
from pathlib import Path
import re
import time
import traceback
import subprocess
from frida_status_delivery import verify_frida_delivery



async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--codex", type=Path, required=True)
    parser.add_argument("--node", type=Path, required=True)
    parser.add_argument("--input-profile", choices=["full", "compact"], default="full")
    parser.add_argument("--output-profile", choices=["full", "off"], default="full")
    parser.add_argument("--script", type=Path, required=True)
    parser.add_argument("--expected-tools", type=int, default=211)
    parser.add_argument("--mode", choices=["complete", "summary"], required=True)
    parser.add_argument("--budget", type=int, default=30000)
    args = parser.parse_args()
    source=args.script.read_text()
    assert args.runtime.is_absolute() and args.output.is_absolute() and args.script.is_absolute()
    def delivered(pieces):
        assert isinstance(pieces,str) and pieces.startswith("Wall time: "), pieces[:300]
        _,sep,payload=pieces.partition("Output:\n");assert sep
        try: value=json.loads(payload)
        except json.JSONDecodeError: return {"_invalid_json_payload":payload}
        return value["result"] if "result" in value and "normalized_result" not in value else value
    def outputs_of(body):
        return {item["call_id"]:delivered(item["output"]) for item in body.get("input",[]) if item.get("type")=="function_call_output"}
    steps=7
    args.output.mkdir(mode=0o700)
    audit_home = args.output / "account"
    codex_state = audit_home / ".codex"
    mcp_home = audit_home / "mcp"
    workspace = audit_home / "workspace"
    for directory in [codex_state, mcp_home, workspace]:
        directory.mkdir(parents=True)
    captured = []
    known_outputs = {}
    state = {"normal_requests":0,"compactions":0}
    class Capture(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass
        def do_POST(self):
            size = int(self.headers["Content-Length"])
            assert 0 < size <= 16 * 1024 * 1024
            assert self.headers.get("Content-Encoding", "identity") == "identity"
            body = json.loads(self.rfile.read(size))
            captured.append({"path": self.path, "body": body})
            (args.output / "model-requests.json").write_text(json.dumps(captured) + "\n")
            http_index = len(captured)
            known_outputs.update(outputs_of(body))
            names = [t.get("name", "") for ns in body.get("tools", []) if ns.get("type") == "namespace" and ns.get("name") == "mcp__rea_audit" for t in ns.get("tools", [])]
            if not names:
                last=body.get('input',[])[-1]
                assert 'CONTEXT CHECKPOINT COMPACTION' in json.dumps(last)
                state['compactions']+=1;assert state['compactions']<=1
                checkpoint={'fixture':'deterministic observed-ID checkpoint, no AI inference','task':'Check Frida session state, queued message count and truncation twice; retain/export complete observations and close instrumentation.','session_id':known_outputs['call_local_1']['session_id'],'delivered_call_ids':list(known_outputs),'remaining':'Continue scripted tools; source message bodies remain in retained Evidence.'}
                text=json.dumps(checkpoint)
                item={"type":"message","id":f"msg_checkpoint_{state['compactions']}","role":"assistant","status":"completed","content":[{"type":"output_text","text":text,"annotations":[]}]}
                captured[-1]['kind']='deterministic-compaction'
            else:
                state['normal_requests']+=1;index=state['normal_requests'];assert index<=steps+1
                captured[-1]['kind']='tool-planning-or-final'
                if index<=steps:
                    if index==1:
                        operation='start_frida_session';arguments={'mode':'spawn','device_id':'local','program':'/usr/bin/sleep','argv':['8']}
                    else:
                        session=known_outputs['call_local_1']['session_id']
                        if index==2:
                            operation='load_frida_script';arguments={'session_id':session,'source_kind':'inline','source':source}
                        elif index==3:
                            operation='resume_frida_session';arguments={'session_id':session}
                        elif index in [4,5]:
                            if index==4: time.sleep(0.75)
                            operation='frida_session_status';arguments={'session_id':session,**({'detail':'summary'} if args.mode=='summary' else {})}
                        elif index==6:
                            operation='close_frida_session';arguments={'session_id':session}
                        else:
                            operation='export_evidence_bundle';arguments={'path':str(args.output/'evidence.json')}
                    selected=[name for name in names if name == operation];assert len(selected)==1
                    item={"type":"function_call","id":f"fc_local_{index}","call_id":f"call_local_{index}","name":selected[0],"namespace":"mcp__rea_audit","arguments":json.dumps(arguments),"status":"completed"}
                else:
                    item={"type":"message","id":"msg_local_done","role":"assistant","status":"completed","content":[{"type":"output_text","text":"Scripted local Frida state and capture-coverage task complete.","annotations":[]}]}
            response_id=f"resp_local_{http_index}"
            base = {"id": response_id, "object": "response", "model": body.get("model"), "status": "completed", "output": [item]}
            events = [
                {"type": "response.created", "response": {**base, "status": "in_progress", "output": []}},
                {"type": "response.output_item.added", "output_index": 0, "item": {**item, "status": "in_progress"}},
                {"type": "response.output_item.done", "output_index": 0, "item": item},
                {"type": "response.completed", "response": base},
            ]
            wire = "".join("event: " + e["type"] + "\ndata: " + json.dumps(e) + "\n\n" for e in events).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(wire)))
            self.end_headers()
            self.wfile.write(wire)
    endpoint = http.server.HTTPServer(("127.0.0.1", 0), Capture)
    endpoint_thread = threading.Thread(target=endpoint.serve_forever, daemon=True)
    endpoint_thread.start()
    task_path = f"{args.node.parent}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
    mcp_env = {"HOME": str(mcp_home), "PATH": task_path,
               "NODE_OPTIONS": "--max-old-space-size=2048", "UV_THREADPOOL_SIZE": "1",
               "REA_LOG_LEVEL": "silent", "REA_MCP_INPUT_SCHEMA_PROFILE": args.input_profile,
               "REA_MCP_OUTPUT_SCHEMA_PROFILE": args.output_profile}
    config = 'model_provider = "rea_capture"\nmodel = "rea-wire-probe"\n[analytics]\nenabled = false\n[mcp_servers.rea_audit]\n'
    config += f'command = {json.dumps(str(args.node))}\n'
    config += f'args = {json.dumps([str(args.runtime / "scripts/rea.mjs"), "mcp"])}\n'
    config += 'startup_timeout_sec = 60\ntool_timeout_sec = 60\n'
    config += '[mcp_servers.rea_audit.env]\n'
    config += ''.join(f'{key} = {json.dumps(value)}\n' for key, value in mcp_env.items())
    for name in ['start_frida_session','load_frida_script','resume_frida_session','frida_session_status','close_frida_session','export_evidence_bundle']:
        config += f'[mcp_servers.rea_audit.tools.{name}]\napproval_mode = "approve"\n'
        if args.budget: config += f'output_token_limit = {args.budget}\n'
    config += f'\n[model_providers.rea_capture]\nname = "Local scripted capture"\nbase_url = "http://127.0.0.1:{endpoint.server_port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nsupports_websockets = false\nrequest_max_retries = 0\nstream_max_retries = 0\n'
    (codex_state / "config.toml").write_text(config)
    (args.output / "declared-config.toml").write_text(config)
    environment = {"HOME": str(audit_home), "CODEX_HOME": str(codex_state), "PATH": task_path,
                   "NODE_OPTIONS": "--max-old-space-size=2048", "UV_THREADPOOL_SIZE": "1"}
    report = {"question": "Retain a caller-requested native libc export inventory, check session identity/state, queued message count and truncation twice, close instrumentation and export complete Evidence.",
              "client": "Codex app-server 0.163.0", "model_turns_started": 1, "backend": "local deterministic SSE fixture; no AI model or paid service",
              "actual_model_usage": None, "input_profile": args.input_profile,
              "output_profile": args.output_profile, "calls": [], "observations": [],
              "unexpected_server_requests": [], "cleanup_failures": []}
    client_version = subprocess.check_output([str(args.codex), "--version"], env=environment, cwd=workspace, text=True, timeout=10).strip()
    assert client_version == "codex-cli 0.163.0", client_version
    transcript = []
    pending = {}
    completed_turn = asyncio.Event()
    next_id = 0
    stderr = (args.output / "server.log").open("wb")
    process = await asyncio.create_subprocess_exec(str(args.codex), "app-server", "--stdio",
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=stderr,
        cwd=workspace, env=environment, limit=16 * 1024 * 1024)

    async def send(message):
        encoded = (json.dumps(message, separators=(",", ":")) + "\n").encode()
        transcript.append({"direction": "client", "bytes": len(encoded), "message": message})
        process.stdin.write(encoded)
        await process.stdin.drain()

    async def read_messages():
        try:
            while line := await process.stdout.readline():
                value = json.loads(line)
                transcript.append({"direction": "server", "bytes": len(line), "message": value})
                if value.get("method") == "turn/completed":
                    report["turn"] = value["params"]["turn"]
                    completed_turn.set()
                if "id" in value and "method" not in value:
                    future = pending.pop(value["id"], None)
                    if future and not future.done():
                        future.set_result(value)
                elif "id" in value:
                    report["unexpected_server_requests"].append(value["method"])
                    await send({"id": value["id"], "error": {"code": -32601, "message": "Unexpected request in scripted metadata probe"}})
            raise RuntimeError("app-server stdout closed")
        except Exception as error:
            for future in pending.values():
                if not future.done():
                    future.set_exception(error)

    reader = asyncio.create_task(read_messages())

    async def request(method, params):
        nonlocal next_id
        assert method in ["initialize", "thread/start", "mcpServerStatus/list", "mcpServer/tool/call", "turn/start"]
        next_id += 1
        message = {"id": next_id, "method": method, "params": params}
        future = asyncio.get_running_loop().create_future()
        pending[next_id] = future
        start = time.monotonic()
        await send(message)
        reply = await asyncio.wait_for(future, 90)
        report["calls"].append({"method": method, "elapsed_ms": (time.monotonic() - start) * 1000,
                                "error": reply.get("error")})
        if "error" in reply:
            raise RuntimeError(json.dumps(reply["error"])[:4000])
        return reply["result"]

    try:
        await request("initialize", {"clientInfo": {"name": "rea_host_probe", "title": "REA host compatibility probe", "version": "1"},
                                     "capabilities": {"experimentalApi": True, "explicitGatewayOauth": True}})
        await send({"method": "initialized"})
        created = await request("thread/start", {"cwd": str(workspace), "ephemeral": True,
                    "approvalPolicy": "never", "sandbox": "read-only"})
        thread_id = created["thread"]["id"]
        assert not created["thread"].get("turns", [])
        inventory = await request("mcpServerStatus/list", {"threadId": thread_id,
                    "serverName": "rea_audit", "detail": "toolsAndAuthOnly", "limit": 10})
        assert inventory.get("nextCursor") is None
        assert len(inventory["data"]) == 1
        server = inventory["data"][0]
        assert server["name"] == "rea_audit" and server.get("toolsError") is None
        tools = list(server["tools"].values())
        names = [tool["name"] for tool in tools]
        assert len(names) == len(set(names)) == args.expected_tools
        assert "frida_session_status" in names
        output_schemas = sum(tool.get("outputSchema") is not None for tool in tools)
        assert output_schemas == (args.expected_tools if args.output_profile == "full" else 0)
        raw = json.dumps(inventory, separators=(",", ":"), ensure_ascii=False).encode()
        (args.output / "catalog.json").write_bytes(raw)
        report["catalog"] = {"tools": len(tools), "output_schemas": output_schemas,
                             "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
                             "server_info": server.get("serverInfo"), "runtime_status": server.get("runtimeStatus")}
        await request("turn/start", {"threadId":thread_id,"input":[{"type":"text","text":"Retain a complete libc export inventory using the selected caller-authored script. Check session state and queued message capture count/truncation twice, close Frida instrumentation and export complete Evidence. The local fixture scripts the tools; no AI inference."}]})
        await asyncio.wait_for(completed_turn.wait(), 90)
        assert report["turn"]["status"] == "completed", report["turn"]
        assert state["normal_requests"]==steps+1
        assert len(captured)==steps+1+state["compactions"]
        outputs=known_outputs
        assert len(outputs)==steps
        bundle=json.loads((args.output/'evidence.json').read_text())
        delivery_complete=True
        answers=[]
        for index in [4,5]:
            delivered_result=outputs[f'call_local_{index}']
            answer=verify_frida_delivery(delivered_result,bundle,args.mode,args.budget,outputs['call_local_1'])
            if answer is None: delivery_complete=False
            else: answers.append(answer)
        loaded=next(e for e in bundle['records'] if e['operation']=='load_frida_script')
        assert loaded['normalized_result']['source_sha256']==hashlib.sha256(source.encode()).hexdigest()
        report['task_completed']=delivery_complete
        report['observations']={'answers':answers,'exported':True,'exported_bundle_bytes':(args.output/'evidence.json').stat().st_size,'tool_output_budget':args.budget or 'client default','source_sha256':hashlib.sha256(source.encode()).hexdigest()}
        report["captured_requests"]=len(captured)
        report["compaction_requests"]=state["compactions"]
        report["compaction_backend"]="Deterministic checkpoint of observed identifiers and retained-body location; no AI inference or quality claim."
        report["mode"]=args.mode
        report["request_tool_counts"] = [len(c["body"].get("tools", [])) for c in captured]
        assert not report["unexpected_server_requests"]
        report["status"] = "passed" if report["task_completed"] else "expected-incomplete-task"
    except Exception:
        report["status"] = "failed"
        report["failure"] = traceback.format_exc()[-6000:]
    finally:
        process.stdin.close()
        try:
            await asyncio.wait_for(process.wait(), 15)
        except asyncio.TimeoutError:
            report["cleanup_failures"].append("app-server did not exit after stdin close; terminated owned process")
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), 5)
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
        await reader
        # app-server can acknowledge exit before its MCP child finishes EOF
        # cleanup. Wait on the allocated resource scope; never target a PID.
        try:
            groups = [line[3:] for line in Path("/proc/self/cgroup").read_text().splitlines()
                      if line.startswith("0::")]
            assert len(groups) == 1
            group = Path("/sys/fs/cgroup") / groups[0].lstrip("/")
            assert re.fullmatch(r"rea-efficiency-[0-9a-f]{32}\.scope", group.name)
            observer = os.getppid()
            observer_args = Path(f"/proc/{observer}/cmdline").read_bytes().split(b"\0")
            assert any(Path(os.fsdecode(value)).name == "resource_payload.py" for value in observer_args if value)
            expected = {os.getpid(), observer}
            until = time.monotonic() + 10
            while True:
                actors = {int(value) for value in (group / "cgroup.procs").read_text().splitlines()}
                assert expected <= actors
                remaining = sorted(actors - expected)
                if not remaining or time.monotonic() >= until:
                    break
                await asyncio.sleep(0.05)
            report["owned_scope_drain"] = {"remaining_processes": remaining}
            if remaining:
                report["cleanup_failures"].append("owned MCP child did not settle after app-server exit")
        except (OSError, ValueError, AssertionError) as error:
            report["owned_scope_drain"] = {"status": "unavailable", "reason": type(error).__name__}
            report["cleanup_failures"].append("allocated resource-scope cleanup could not be verified")
        endpoint.shutdown()
        endpoint.server_close()
        endpoint_thread.join(5)
        stderr.close()
        report["appserver_exit_code"] = process.returncode
        if process.returncode != 0:
            report["cleanup_failures"].append(f"app-server exit code: {process.returncode}")
        (args.output / "transcript.json").write_text(json.dumps(transcript) + "\n")
        (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({key: report.get(key) for key in ["status", "failure", "catalog", "observations", "cleanup_failures", "appserver_exit_code"]}))
    return 0 if report["status"] in ["passed","expected-incomplete-task"] and not report["cleanup_failures"] else 1


raise SystemExit(asyncio.run(main()))
