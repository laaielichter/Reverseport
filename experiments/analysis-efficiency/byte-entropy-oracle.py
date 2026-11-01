"""Independent Python histogram oracle; reads artifact bytes without execution."""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path

def entropy(counts, size):
    if not size:
        return 0
    value = -sum((counts[k] / size) * math.log2(counts[k] / size) for k in sorted(counts) if counts[k])
    return math.floor(value * 10000 + 0.5) / 10000

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--path', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--block-size', type=int, required=True)
    parser.add_argument('--offset', type=int, default=0)
    parser.add_argument('--length', type=int)
    args = parser.parse_args()
    path = Path(args.path)
    before = path.stat()
    counts = Counter()
    digest = hashlib.sha256()
    with path.open('rb') as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
            counts.update(chunk)
        length = args.length if args.length is not None else before.st_size - args.offset
        assert 0 <= args.offset <= before.st_size and 0 <= length <= before.st_size - args.offset
        blocks, runs = [], []
        source.seek(args.offset)
        for offset in range(args.offset, args.offset + length, args.block_size):
            chunk = source.read(min(args.block_size, args.offset + length - offset))
            value = entropy(Counter(chunk), len(chunk))
            block = {'offset': offset, 'length': len(chunk), 'entropy': value}
            blocks.append(block)
            classification = 'high' if value >= 7.2 else 'low' if value <= 1 else None
            if classification is not None:
                if runs and runs[-1]['classification'] == classification and runs[-1]['offset'] + runs[-1]['length'] == offset:
                    runs[-1]['length'] += len(chunk)
                else:
                    runs.append({'offset': offset, 'length': len(chunk), 'classification': classification})
    after = path.stat()
    assert (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
    expected = {'artifact': {'path': args.path, 'bytes': before.st_size, 'sha256': digest.hexdigest()}, 'block_size':args.block_size,'window':{'offset':args.offset,'length':length},'file_entropy':entropy(counts,before.st_size),'thresholds':{'high':7.2,'low':1},'blocks':blocks,'runs':runs}
    request = {'path':args.path,'block_size':args.block_size,'offset':args.offset}
    if args.length is not None:
        request['length'] = args.length
    Path(args.output).write_text(json.dumps({'input':request,'expected':expected},indent=2)+'\n')
    print(json.dumps({'path':args.path,'sha256':digest.hexdigest(),'blocks':len(blocks),'runs':len(runs)}))

if __name__ == '__main__':
    main()
