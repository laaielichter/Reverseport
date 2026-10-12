using UnityEngine;

public class Enemy : MonoBehaviour
{
    [SerializeField] private int damage = 10;

    void OnTriggerEnter(Collider other)
    {
        var player = other.GetComponent<Player>();
        if (player != null)
        {
            player.TakeHit(damage);
            Debug.Log("enemy hit player");
        }
    }
}
