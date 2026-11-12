// port_draft: GDScript → C# first drafts. The assertions pin what is translated mechanically and, just as
// important, that nothing the translator cannot handle disappears without a PORT: marker.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MINI = path.join(HERE, 'fixtures', 'godot-mini');
const dir = await tempDir();
process.env.REVERSEPORT_HOME = path.join(dir, 'home');
const { callTool } = await import('../src/tools.mjs');
const { draftGdscript, draftFile, projectFacts, parseExpr, logicalLines, blockTree } = await import('../src/draft.mjs');

const gd = (text, opts = {}) => draftGdscript(text.replace(/^\n/, ''), { className: 'Thing', ...opts });
/** Brackets outside strings and comments must balance, or the draft cannot even be parsed by a compiler. */
function balanced(code) {
  const bare = code.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n').replace(/@"(?:[^"]|"")*"/g, '""').replace(/\$?"(?:[^"\\]|\\.)*"/g, '""').replace(/\/\/.*$/gm, '');
  return [...bare].reduce((n, c) => n + ('{(['.includes(c) ? 1 : '})]'.includes(c) ? -1 : 0), 0) === 0;
}

test('lines: brackets and backslashes continue a statement, comments stay with their line', () => {
  const lines = logicalLines('var a = [\n\t1, # one\n\t2,\n]\nif a and \\\n\tb: # why\n\tpass\n');
  assert.deepEqual(lines.filter(l => l.text).map(l => l.text.replace(/\s+/g, ' ')), ['var a = [ 1, 2, ]', 'if a and b:', 'pass']);
  assert.equal(lines.find(l => l.text.startsWith('if')).comment, '# why');
  const tree = blockTree(logicalLines('func f():\n\tif x:\n\t\ty()\n\n\t# note\n\tz()\n'));
  assert.equal(tree[0].children.filter(n => n.text).length, 2, 'if and z() are the function body');
  assert.equal(tree[0].children[0].children.filter(n => n.text).length, 1, 'a blank line does not join the if body');
});

test('expressions: precedence, ternary, not in, is not, casts and lambdas parse into trees', () => {
  assert.equal(parseExpr('a if b else c').k, 'tern');
  assert.equal(parseExpr('not a and b').op, 'and');
  assert.equal(parseExpr('x not in list').op, 'not in');
  assert.equal(parseExpr('x is not Node').negate, true);
  assert.equal(parseExpr('1 + 2 * 3').op, '+');
  assert.equal(parseExpr('$Gun/Muzzle.global_position').e.path, 'Gun/Muzzle');
  assert.equal(parseExpr('func(a, b): return a + b').k, 'lambda');
  assert.throws(() => parseExpr('a +'), /unexpected end/);
});

test('Godot C#: the fixture player becomes a partial class with typed nodes, signals, with-expressions and await', async () => {
  const r = await draftFile(path.join(MINI, 'actors', 'player.gd'), { to: 'godot-csharp' });
  const c = r.content;
  assert.match(c, /^using Godot;$/m);
  assert.match(c, /\[GlobalClass\]\npublic partial class Player : CharacterBody3D/);
  assert.match(c, /\[Signal\]\n\s+public delegate void HitEventHandler\(int damage\);/);
  assert.match(c, /\[Export\]\n\s+public float Speed \{ get; set; \} = 6\.0f;/);
  assert.match(c, /public Marker3D Muzzle;/, 'the node type comes from player.tscn');
  assert.match(c, /Muzzle = GetNode<Marker3D>\("Gun\/Muzzle"\);/);
  assert.match(c, /public static readonly PackedScene BULLET = GD\.Load<PackedScene>\("res:\/\/actors\/bullet\.tscn"\);/);
  assert.match(c, /public override void _PhysicsProcess\(double delta\)/);
  assert.match(c, /Velocity \+= GetGravity\(\) \* \(float\)delta;/);
  assert.match(c, /Velocity = Velocity with \{ X = dir \* Speed \};/, 'a struct property is not changed in place');
  assert.match(c, /Hit \+= OnHit;/);
  assert.match(c, /private async void OnHit\(int damage\)/);
  assert.match(c, /GetNode<Global>\("\/root\/Global"\)\.AddScore\(-damage\);/, 'autoloads come from project.godot');
  assert.match(c, /await ToSignal\(GetTree\(\)\.CreateTimer\(0\.5f\), SceneTreeTimer\.SignalName\.Timeout\);/);
  assert.equal(r.markers.length, 0, JSON.stringify(r.markers));
  assert.ok(balanced(c));
  assert.deepEqual(r.facts.scenes, ['actors/player.tscn']);
});

test('Godot C#: own signals emit through SignalName, other objects keep a marker', async () => {
  const global = await draftFile(path.join(MINI, 'global.gd'), { to: 'godot-csharp' });
  assert.match(global.content, /EmitSignal\(SignalName\.ScoreChanged, Score\); \/\/ notify the HUD/, 'the source comment stays on its line');
  const hud = await draftFile(path.join(MINI, 'ui', 'hud.gd'), { to: 'godot-csharp' });
  assert.match(hud.content, /GetNode<Global>\("\/root\/Global"\)\.ScoreChanged \+= OnScoreChanged;/);
  assert.match(hud.content, /Label\.Text = \$"Score: \{newScore\}";/);
  const enemy = await draftFile(path.join(MINI, 'actors', 'enemy.gd'), { to: 'godot-csharp' });
  assert.match(enemy.content, /BodyEntered \+= OnBodyEntered;/, 'an inherited engine signal');
  assert.match(enemy.content, /body\.EmitSignal\("Hit", Damage\); \/\/ PORT: signal hit of another class/);
  assert.equal(enemy.markers.length, 1);
});

test('Unity: structure, lifecycle and events carry over; every Godot API call stays visible with a marker', async () => {
  const r = await draftFile(path.join(MINI, 'actors', 'player.gd'), { to: 'unity' });
  const c = r.content;
  assert.match(c, /using System;\nusing UnityEngine;/);
  assert.match(c, /\[RequireComponent\(typeof\(CharacterController\)\)\]\npublic class Player : MonoBehaviour/);
  assert.match(c, /\/\/ PORT: Godot base CharacterBody3D: CharacterController\.Move/);
  assert.match(c, /public event Action<int> Hit;/);
  assert.match(c, /public float speed = 6\.0f;/);
  assert.match(c, /\[SerializeField\] private GameObject BULLET; \/\/ PORT: preload: assign BULLET in the inspector/);
  assert.match(c, /void FixedUpdate\(\)/);
  assert.match(c, /velocity \+= get_gravity\(\) \* Time\.fixedDeltaTime; \/\/ PORT: .*Godot API get_gravity\(\)/);
  assert.match(c, /move_and_slide\(\); \/\/ PORT: Godot API move_and_slide\(\)/);
  assert.match(c, /if \(Input\.GetButtonDown\("fire"\)\)/);
  assert.match(c, /Global\.Instance\.AddScore\(-damage\);/);
  assert.match(c, /await Awaitable\.WaitForSecondsAsync\(0\.5f\);/);
  assert.match(c, /Destroy\(gameObject\);/);
  assert.ok(r.markers.length >= 8, 'Godot physics, nodes and groups are all marked');
  assert.ok(balanced(c));
  const global = await draftFile(path.join(MINI, 'global.gd'), { to: 'unity' });
  assert.match(global.content, /public static Global Instance \{ get; private set; \}/, 'an autoload becomes a singleton');
  assert.match(global.content, /void Awake\(\)\n\s+\{\n\s+Instance = this;/);
  assert.match(global.content, /ScoreChanged\?\.Invoke\(score\);/);
  const enemy = await draftFile(path.join(MINI, 'actors', 'enemy.gd'), { to: 'unity' });
  assert.match(enemy.content, /\/\/ PORT: could not translate \(Godot signal body_entered: Collider with isTrigger = true \+ OnTriggerEnter\(Collider other\)\): body_entered\.connect\(_on_body_entered\)/);
});

test('control flow: for ranges, typed foreach, while, match → switch, inline bodies', () => {
  const { content: c, markers } = gd(`
extends Node

enum State { IDLE, RUN }
var state: State = State.IDLE
var items: Array[int] = []

func tick(n: int) -> int:
	var total := 0
	for i in range(n):
		total += i
	for i in range(10, 0, -2):
		total -= i
	for item: int in items:
		if item > 3: continue
		total += item
	while total > 100:
		total /= 2
	match state:
		State.IDLE, State.RUN:
			total += 1
		_:
			return 0
	return total if total > 0 else -total
`);
  assert.match(c, /public enum State \{ IDLE, RUN \}/);
  assert.match(c, /public State State = State\.IDLE;/);
  assert.match(c, /public Godot\.Collections\.Array<int> Items = new Godot\.Collections\.Array\(\);/);
  assert.match(c, /for \(int i = 0; i < n; i\+\+\)/);
  assert.match(c, /for \(int i = 10; i > 0; i \+= -2\)/);
  assert.match(c, /foreach \(int item in Items\)/);
  assert.match(c, /if \(item > 3\)\n\s+\{\n\s+continue;/);
  assert.match(c, /switch \(State\)\n\s+\{\n\s+case State\.IDLE:\n\s+case State\.RUN:\n\s+total \+= 1;\n\s+break;\n\s+default:\n\s+return 0;\n\s+\}/);
  assert.match(c, /return total > 0 \? total : -total;/);
  assert.equal(markers.length, 0, JSON.stringify(markers));
  assert.ok(balanced(c));
});

test('expressions: math, strings, collections, constants and casts', () => {
  const { content: c } = gd(`
extends Node2D

const SPEED := 4.5
var names := ["a", "b"]
var lookup := {"hp": 10, "mp": 3}

func f(v: Vector2, other: Node) -> String:
	var a := clamp(lerp(0.0, 1.0, 0.5), 0.0, PI)
	var b := v.length() ** 2
	var up := Vector2.UP * SPEED
	position.x += up.x
	if not other is Sprite2D and names.size() > 1:
		names.append(str(a))
	var sprite := other as Sprite2D
	var text := "%s has %05d points (%.1f%%)" % [name, 42, b]
	print("done: ", text)
	return 'it''s "quoted"'
`);
  assert.match(c, /public const float SPEED = 4\.5f;/);
  assert.match(c, /public Godot\.Collections\.Array Names = new Godot\.Collections\.Array \{ "a", "b" \};/);
  assert.match(c, /new Godot\.Collections\.Dictionary \{ \{ "hp", 10 \}, \{ "mp", 3 \} \};/);
  assert.match(c, /var a = Mathf\.Clamp\(Mathf\.Lerp\(0\.0f, 1\.0f, 0\.5f\), 0\.0f, Mathf\.Pi\);/);
  assert.match(c, /var b = Mathf\.Pow\(v\.Length\(\), 2\);/);
  assert.match(c, /var up = Vector2\.Up \* SPEED;/);
  assert.match(c, /Position = Position with \{ X = Position\.X \+ up\.X \};/);
  assert.match(c, /if \(!\(other is Sprite2D\) && Names\.Count > 1\)/);
  assert.match(c, /Names\.Add\(GD\.Str\(a\)\);/);
  assert.match(c, /var sprite = other as Sprite2D;/);
  assert.match(c, /var text = \$"\{Name\} has \{42:D5\} points \(\{b:F1\}%\)";/);
  assert.match(c, /GD\.Print\("done: ", text\);/);
  assert.ok(balanced(c));
});

test('nothing is dropped: what cannot be translated stays in place with a PORT marker', () => {
  const { content: c, markers } = gd(`
extends Node

var hp := 10:
	set(value):
		hp = max(value, 0)
var mystery = compute()

func run(data):
	match data:
		[var first, ..]:
			print(first)
	button.pressed.connect(func():
		print("multi")
		print("line"))
	return data
`);
  assert.match(c, /public int Hp = 10; \/\/ PORT: property hp has a setter or getter/);
  assert.match(c, /\/\/ set\(value\):\n\s+\/\/ hp = max\(value, 0\)/, 'the setter body is kept as a comment');
  assert.match(c, /public Variant Mystery = Compute\(\); \/\/ PORT: type of mystery could not be inferred/);
  assert.match(c, /public Variant Run\(Variant data\) \/\/ PORT: return type of run\(\) is not declared/);
  assert.match(c, /\/\/ PORT: match pattern "\[var first, \.\.\]"/);
  assert.match(c, /\/\/ PORT: could not translate \(.*\): button\.pressed\.connect\(func\(\):/, 'a multi-line lambda keeps its source text');
  assert.ok(markers.length >= 5);
  assert.ok(balanced(c));
  for (const m of markers) assert.ok(Number.isInteger(m.line) && m.line >= 1, 'every marker names a source line');
});

test('inner classes, static functions, constructors and super calls', () => {
  const { content: c } = gd(`
class_name Inventory
extends RefCounted

class Slot:
	var count := 0
	func add(n: int) -> void:
		count += n

static func create() -> Inventory:
	return Inventory.new()

func _init(size: int = 4) -> void:
	super()
	resize(size)

func resize(size: int) -> void:
	pass
`, { className: 'Inventory' });
  assert.match(c, /public partial class Inventory : RefCounted/);
  assert.match(c, /public partial class Slot : RefCounted\n\s+\{\n\s+public int Count = 0;/);
  assert.match(c, /public static Inventory Create\(\)\n\s+\{\n\s+return new Inventory\(\);/);
  assert.match(c, /public Inventory\(int size = 4\)/);
  assert.match(c, /Resize\(size\);/);
  assert.ok(balanced(c));
});

test('project facts: autoloads and node types are read from the project', async () => {
  const facts = await projectFacts(path.join(MINI, 'actors', 'player.gd'));
  assert.equal(facts.root, MINI);
  assert.equal(facts.autoloads.get('Global'), 'global.gd');
  assert.equal(facts.nodeTypes.get('Gun/Muzzle'), 'Marker3D');
  assert.equal(facts.nodeTypes.get('AnimationPlayer'), 'AnimationPlayer');
  const outside = await projectFacts(path.join(dir, 'nowhere.gd'));
  assert.equal(outside.root, null);
});

test('tool without a plan: writes the draft into the workspace and reports what is open', async () => {
  const r = await callTool('port_draft', { file: path.join(MINI, 'actors', 'enemy.gd'), to: 'godot-csharp' });
  assert.ok(r.file.startsWith(path.join(dir, 'home', 'drafts')));
  assert.equal(await fs.readFile(r.file, 'utf8'), r.draft);
  assert.equal(r.portMarkers, 1);
  assert.equal(r.open[0].count, 1);
  assert.match(r.next, /Resolve the 1 "PORT:" line/);
  await assert.rejects(callTool('port_draft', { file: path.join(MINI, 'main.tscn'), to: 'unity' }), /reads GDScript/);
  await assert.rejects(callTool('port_draft', { file: path.join(MINI, 'global.gd'), to: 'unreal' }), e => e.code === 'INVALID_ARGUMENT');
  await assert.rejects(callTool('port_draft', {}), /Give file/);
});

test('with a plan: port_unit points at the draft, the draft is partial until port_write, verify stays honest', async () => {
  const plan = await callTool('port_plan', { source: MINI, to: 'godot-csharp', output: path.join(dir, 'out-cs') });
  const unit = await callTool('port_unit', { planId: plan.planId, unit: 'actors/player.gd' });
  assert.equal(unit.nextCall.tool, 'port_draft');
  const d = await callTool('port_draft', unit.nextCall.arguments);
  assert.equal(d.status, 'partial');
  assert.equal(d.nextCall.tool, 'port_write');
  const target = path.join(plan.output, 'actors', 'Player.cs');
  assert.equal(await fs.readFile(target, 'utf8'), d.draft);
  const again = await callTool('port_unit', { planId: plan.planId, unit: 'actors/player.gd' });
  assert.equal(again.draft.file, target);
  assert.equal(again.nextCall.tool, 'port_write', 'a drafted unit is reviewed, not drafted again');
  const all = await callTool('port_draft', { planId: plan.planId, all: true });
  assert.equal(all.drafted, 5, 'the other five scripts');
  assert.equal(all.progress.partial, 6);
  assert.equal(all.units[0].draft, undefined, 'the summary does not repeat the code');
  const v = await callTool('port_verify', { planId: plan.planId });
  assert.equal(v.passed, false, 'drafts alone never pass');
  assert.equal(v.missingSymbols, 0, 'every source function and signal is in the drafts');
  assert.equal(v.leftovers, 0);
  const w = await callTool('port_write', { planId: plan.planId, unit: 'actors/player.gd', content: d.draft });
  assert.equal(w.status, 'done');
  await assert.rejects(callTool('port_draft', { planId: plan.planId, unit: 'actors/player.gd' }), e => e.code === 'ALREADY_PORTED');
  await assert.rejects(callTool('port_draft', { planId: plan.planId, unit: 'main.tscn' }), e => e.code === 'NO_DRAFT');
});

test('plans to other targets keep the manual route', async () => {
  const plan = await callTool('port_plan', { source: MINI, to: 'threejs', output: path.join(dir, 'out-three') });
  const unit = await callTool('port_unit', { planId: plan.planId, unit: 'actors/player.gd' });
  assert.equal(unit.nextCall.tool, 'port_write');
  await assert.rejects(callTool('port_draft', { planId: plan.planId, unit: 'actors/player.gd' }), e => e.code === 'NO_DRAFT');
});

test('identifiers that are also JavaScript object members are plain names', () => {
  const { content: c } = gd(`
extends Node

var constructor := 1
var value_of := 2

func to_string_twice(has_own_property: int) -> int:
	return constructor + value_of + has_own_property
`);
  assert.match(c, /public int Constructor = 1;/);
  assert.match(c, /return Constructor \+ ValueOf \+ hasOwnProperty;/);
  assert.ok(!/native code|function /.test(c));
});

test('scripted and instanced nodes get the class of their script', async () => {
  const root = path.join(dir, 'typed');
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, 'project.godot'), '; Engine configuration file\nconfig_version=5\n');
  await fs.writeFile(path.join(root, 'hud.gd'), 'extends CanvasLayer\n\nfunc show_message(text: String) -> void:\n\tpass\n');
  await fs.writeFile(path.join(root, 'mob.gd'), 'extends RigidBody2D\n');
  await fs.writeFile(path.join(root, 'mob.tscn'), '[gd_scene format=3]\n\n[ext_resource type="Script" path="res://mob.gd" id="1"]\n\n[node name="Mob" type="RigidBody2D"]\nscript = ExtResource("1")\n');
  await fs.writeFile(path.join(root, 'main.gd'), 'extends Node\n\nfunc start() -> void:\n\t$HUD.show_message("Go")\n\tvar boss = get_node("Boss")\n\tboss.sleeping = true\n\t$Path/Follow.progress_ratio = 0.5\n');
  await fs.writeFile(path.join(root, 'main.tscn'), ['[gd_scene format=3]', '', '[ext_resource type="Script" path="res://main.gd" id="1"]', '[ext_resource type="Script" path="res://hud.gd" id="2"]', '[ext_resource type="PackedScene" path="res://mob.tscn" id="3"]', '',
    '[node name="Main" type="Node"]', 'script = ExtResource("1")', '', '[node name="HUD" type="CanvasLayer" parent="."]', 'script = ExtResource("2")', '', '[node name="Boss" parent="." instance=ExtResource("3")]', '',
    '[node name="Path" type="Path2D" parent="."]', '', '[node name="Follow" type="PathFollow2D" parent="Path"]', ''].join('\n'));
  const r = await draftFile(path.join(root, 'main.gd'), { to: 'godot-csharp' });
  assert.match(r.content, /GetNode<Hud>\("HUD"\)\.ShowMessage\("Go"\);/);
  assert.match(r.content, /var boss = GetNode<Mob>\("Boss"\);/);
  assert.match(r.content, /GetNode<PathFollow2D>\("Path\/Follow"\)\.ProgressRatio = 0\.5f;/);
  assert.equal(r.markers.length, 0, JSON.stringify(r.markers));
});

test('single-quoted strings: escaped quotes and backslashes survive, also inside a format string', () => {
  const { content: c } = gd("extends Node\n\nfunc f(n: int) -> String:\n\tvar a := 'say \\\"hi\\\" it\\'s \"x\" \\\\'\n\treturn 'n=\"%d\" \\\"q\\\"' % n\n");
  assert.ok(c.includes(String.raw`var a = "say \"hi\" it's \"x\" \\";`), c);
  assert.ok(c.includes(String.raw`return $"n=\"{n}\" \"q\"";`), c);
});
