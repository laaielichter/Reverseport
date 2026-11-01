"""Read archived AppKit connector UIDs independently with Python's plistlib."""

import argparse
import hashlib
import json
from pathlib import Path
import plistlib


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--document', required=True)
    parser.add_argument('--baseline', type=Path, required=True,
                        help='Complete pre-change 64-document Evidence; equality control, not the oracle')
    parser.add_argument('--small-baseline', type=Path, required=True,
                        help='Complete pre-change 1-document Evidence')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    data = (args.bundle / args.document).read_bytes()
    objects = plistlib.loads(data)['$objects']
    connections = []
    for index, value in enumerate(objects):
        if not isinstance(value, dict) or not {'NSSource', 'NSLabel'} <= value.keys():
            continue
        classname = objects[value['$class'].data]['$classname']
        if classname not in ('NSNibOutletConnector', 'NSNibControlConnector'):
            continue
        connections.append({
            'archive_index': index,
            'kind': 'outlet' if classname == 'NSNibOutletConnector' else 'action',
            'name': objects[value['NSLabel'].data],
            'source': str(value['NSSource'].data),
            'destination': str(value['NSDestination'].data),
        })
    if not connections:
        raise ValueError('No supported archived connectors; choose a keyed AppKit document')
    args.output.write_text(json.dumps({
        'document': args.document,
        'archive_sha256': hashlib.sha256(data).hexdigest(),
        'connections': connections,
        'complete_result_paths': {
            '1': str(args.small_baseline.resolve()),
            '64': str(args.baseline.resolve()),
        },
    }, indent=2) + '\n')


if __name__ == '__main__':
    main()
