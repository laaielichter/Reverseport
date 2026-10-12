// ReversePort scene builder for Unity (Editor only).
// Menu: Tools ▸ ReversePort ▸ Build prefabs and scenes from specs
// Reads every *.scene.json under Assets/ (written by ReversePort's port_scene from Godot scenes) and builds
// prefabs and scenes from them: hierarchy, transforms (already converted to Unity axes), primitive meshes,
// colliders, rigidbodies, cameras, lights, audio sources, tags and your ported scripts (by class name).
// Specs are built in their "order" (dependencies first), so nested prefabs exist before they are used.
#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace ReversePort
{
    public static class SceneBuilder
    {
        [Serializable]
        public class NodeSpec
        {
            public string name;
            public int parent = -1;
            public float[] position;
            public float[] rotation;
            public float[] scale;
            public string[] components;
            public string script;
            public string prefab;
            public string tag;
            public string mesh;
            public float[] meshSize;
            public string collider;
            public float[] size;
            public float radius;
            public float height;
            public bool trigger;
            public bool kinematic;
            public float fov;
            public string light;
            public string godotType;
        }

        [Serializable]
        public class SceneSpec
        {
            public string generator;
            public string kind;
            public string name;
            public int order;
            public string savePath;
            public NodeSpec[] nodes;
        }

        static Dictionary<string, Type> typeCache;

        [MenuItem("Tools/ReversePort/Build prefabs and scenes from specs")]
        public static void BuildAll()
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            var files = Directory.GetFiles(Application.dataPath, "*.scene.json", SearchOption.AllDirectories);
            var specs = new List<SceneSpec>();
            foreach (var file in files)
            {
                try
                {
                    var spec = JsonUtility.FromJson<SceneSpec>(File.ReadAllText(file));
                    if (spec != null && spec.nodes != null && spec.nodes.Length > 0 && !string.IsNullOrEmpty(spec.savePath)) specs.Add(spec);
                }
                catch (Exception e) { Debug.LogError($"ReversePort: cannot read {file}: {e.Message}"); }
            }
            typeCache = null;
            int built = 0;
            foreach (var spec in specs.OrderBy(s => s.order))
            {
                try { Build(spec); built++; }
                catch (Exception e) { Debug.LogError($"ReversePort: {spec.name}: {e}"); }
            }
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log($"ReversePort: built {built} of {specs.Count} prefab/scene specs.");
        }

        static void Build(SceneSpec spec)
        {
            var dir = Path.GetDirectoryName(spec.savePath);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            if (spec.kind == "scene")
            {
                var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                CreateObjects(spec);
                EditorSceneManager.SaveScene(scene, spec.savePath);
            }
            else
            {
                var objects = CreateObjects(spec);
                PrefabUtility.SaveAsPrefabAsset(objects[0], spec.savePath);
                UnityEngine.Object.DestroyImmediate(objects[0]);
            }
            AssetDatabase.ImportAsset(spec.savePath);
        }

        static List<GameObject> CreateObjects(SceneSpec spec)
        {
            var list = new List<GameObject>();
            foreach (var n in spec.nodes)
            {
                GameObject go = null;
                if (!string.IsNullOrEmpty(n.prefab))
                {
                    var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(n.prefab);
                    if (prefab != null) go = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                    else Debug.LogWarning($"ReversePort: prefab {n.prefab} not found for {n.name}; build or port it first.");
                }
                if (go == null) go = new GameObject();
                go.name = string.IsNullOrEmpty(n.name) ? "Node" : n.name;
                var parent = n.parent >= 0 && n.parent < list.Count ? list[n.parent] : null;
                if (parent != null) go.transform.SetParent(parent.transform, false);
                if (n.position != null && n.position.Length == 3) go.transform.localPosition = new Vector3(n.position[0], n.position[1], n.position[2]);
                if (n.rotation != null && n.rotation.Length == 4) go.transform.localRotation = new Quaternion(n.rotation[0], n.rotation[1], n.rotation[2], n.rotation[3]);
                if (n.scale != null && n.scale.Length == 3) go.transform.localScale = new Vector3(n.scale[0], n.scale[1], n.scale[2]);
                if (!string.IsNullOrEmpty(n.tag)) SetTag(go, n.tag);
                AddComponents(go, n);
                list.Add(go);
            }
            return list;
        }

        static T Get<T>(GameObject go) where T : Component
        {
            var c = go.GetComponent<T>();
            return c != null ? c : go.AddComponent<T>();
        }

        static void AddComponents(GameObject go, NodeSpec n)
        {
            if (n.components != null)
            {
                foreach (var c in n.components)
                {
                    switch (c)
                    {
                        case "Rigidbody": Get<Rigidbody>(go).isKinematic = n.kinematic; break;
                        case "CharacterController":
                        {
                            var cc = Get<CharacterController>(go);
                            if (n.radius > 0) cc.radius = n.radius;
                            if (n.height > 0) cc.height = n.height;
                            break;
                        }
                        case "Camera": { var cam = Get<Camera>(go); if (n.fov > 0) cam.fieldOfView = n.fov; break; }
                        case "Light":
                        {
                            var l = Get<Light>(go);
                            l.type = n.light == "directional" ? LightType.Directional : n.light == "spot" ? LightType.Spot : LightType.Point;
                            break;
                        }
                        case "AudioSource": Get<AudioSource>(go).spatialBlend = 1f; break;
                    }
                }
            }
            if (!string.IsNullOrEmpty(n.mesh)) AddPrimitiveMesh(go, n);
            if (!string.IsNullOrEmpty(n.collider))
            {
                Collider col = null;
                switch (n.collider)
                {
                    case "box":
                    {
                        var b = go.AddComponent<BoxCollider>();
                        if (n.size != null && n.size.Length == 3) b.size = new Vector3(n.size[0], n.size[1], n.size[2]);
                        col = b;
                        break;
                    }
                    case "sphere":
                    {
                        var s = go.AddComponent<SphereCollider>();
                        if (n.radius > 0) s.radius = n.radius;
                        col = s;
                        break;
                    }
                    case "capsule":
                    {
                        var cc = go.AddComponent<CapsuleCollider>();
                        if (n.radius > 0) cc.radius = n.radius;
                        if (n.height > 0) cc.height = n.height;
                        col = cc;
                        break;
                    }
                }
                if (col != null) col.isTrigger = n.trigger;
            }
            if (!string.IsNullOrEmpty(n.script))
            {
                var type = FindType(n.script);
                if (type != null) go.AddComponent(type);
                else Debug.LogWarning($"ReversePort: script class {n.script} not found for {n.name} (port it first, and fix compile errors).");
            }
        }

        static void AddPrimitiveMesh(GameObject go, NodeSpec n)
        {
            var m = n.meshSize;
            PrimitiveType type;
            var scale = Vector3.one;
            switch (n.mesh)
            {
                case "box": type = PrimitiveType.Cube; if (m != null && m.Length >= 3) scale = new Vector3(m[0], m[1], m[2]); break;
                case "sphere": type = PrimitiveType.Sphere; if (m != null && m.Length >= 1) scale = Vector3.one * (m[0] * 2f); break;
                case "capsule": type = PrimitiveType.Capsule; if (m != null && m.Length >= 2) scale = new Vector3(m[0] / 0.5f, m[1] / 2f, m[0] / 0.5f); break;
                case "cylinder": type = PrimitiveType.Cylinder; if (m != null && m.Length >= 2) scale = new Vector3(m[0] / 0.5f, m[1] / 2f, m[0] / 0.5f); break;
                case "plane": type = PrimitiveType.Plane; if (m != null && m.Length >= 2) scale = new Vector3(m[0] / 10f, 1f, m[1] / 10f); break;
                default: type = PrimitiveType.Quad; if (m != null && m.Length >= 2) scale = new Vector3(m[0], m[1], 1f); break;
            }
            var tmp = GameObject.CreatePrimitive(type);
            var meshGo = new GameObject("Mesh");
            meshGo.transform.SetParent(go.transform, false);
            meshGo.transform.localScale = scale;
            meshGo.AddComponent<MeshFilter>().sharedMesh = tmp.GetComponent<MeshFilter>().sharedMesh;
            meshGo.AddComponent<MeshRenderer>().sharedMaterial = tmp.GetComponent<MeshRenderer>().sharedMaterial;
            UnityEngine.Object.DestroyImmediate(tmp);
        }

        static Type FindType(string name)
        {
            if (typeCache == null)
            {
                typeCache = new Dictionary<string, Type>();
                foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
                {
                    Type[] types;
                    try { types = asm.GetTypes(); }
                    catch (System.Reflection.ReflectionTypeLoadException e) { types = e.Types.Where(t => t != null).ToArray(); }
                    foreach (var t in types)
                        if (typeof(MonoBehaviour).IsAssignableFrom(t) && !t.IsAbstract && !typeCache.ContainsKey(t.Name)) typeCache[t.Name] = t;
                }
            }
            return typeCache.TryGetValue(name, out var found) ? found : null;
        }

        static void SetTag(GameObject go, string tag)
        {
            try { go.tag = tag; return; }
            catch (UnityException) { }
            var assets = AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/TagManager.asset");
            if (assets == null || assets.Length == 0) return;
            var tagManager = new SerializedObject(assets[0]);
            var tags = tagManager.FindProperty("tags");
            tags.InsertArrayElementAtIndex(tags.arraySize);
            tags.GetArrayElementAtIndex(tags.arraySize - 1).stringValue = tag;
            tagManager.ApplyModifiedPropertiesWithoutUndo();
            try { go.tag = tag; }
            catch (UnityException) { Debug.LogWarning($"ReversePort: could not create tag {tag}."); }
        }
    }
}
#endif
