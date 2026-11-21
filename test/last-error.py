# Prints errors from the most recent n8n executions (sqlite) — debugging aid for test/e2e.sh
import sqlite3, json, sys
db = sqlite3.connect(sys.argv[1])
rows = db.execute("select e.id, e.workflowId, e.status, d.data from execution_entity e join execution_data d on d.executionId=e.id order by e.id desc limit ?", (int(sys.argv[2]) if len(sys.argv) > 2 else 6,)).fetchall()
for eid, wf, status, data in rows:
    print(f"#{eid} {wf} {status}")
    if status != 'success':
        arr = json.loads(data)
        # n8n "flatted" format: find strings that look like error messages
        for s in arr:
            if isinstance(s, str) and any(k in s for k in ('Error', 'error', 'failed', 'not ')) and len(s) < 400:
                print("   ", s)
