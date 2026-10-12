using System.Collections;
using UnityEngine;

// Ported from res://actors/bullet.gd (RigidBody3D) by an agent with ReversePort.
[RequireComponent(typeof(Rigidbody))]
public class Bullet : MonoBehaviour
{
    void Start()
    {
        GetComponent<Rigidbody>().AddForce(transform.forward * 30f, ForceMode.Impulse);
        StartCoroutine(ShrinkAndFree(2f));
    }

    IEnumerator ShrinkAndFree(float seconds)
    {
        var start = transform.localScale;
        for (float t = 0; t < seconds; t += Time.deltaTime)
        {
            transform.localScale = Vector3.Lerp(start, Vector3.zero, t / seconds);
            yield return null;
        }
        Destroy(gameObject);
    }
}
