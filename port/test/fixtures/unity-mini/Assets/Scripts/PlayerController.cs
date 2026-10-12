using System;
using UnityEngine;

namespace MiniHeli
{
    [RequireComponent(typeof(Rigidbody))]
    public class PlayerController : MonoBehaviour
    {
        [SerializeField] private float speed = 6f;
        [SerializeField] private Transform muzzle;
        public GameObject bulletPrefab;
        public event Action<int> Hit;

        private Rigidbody body;
        private Health health;

        private void Awake()
        {
            body = GetComponent<Rigidbody>();
            health = GetComponent<Health>();
        }

        private void Update()
        {
            if (Input.GetButtonDown("Fire1"))
            {
                Shoot();
            }
        }

        private void FixedUpdate()
        {
            float h = Input.GetAxis("Horizontal");
            body.velocity = new Vector3(h * speed, body.velocity.y, 0f);
        }

        public void Shoot()
        {
            var b = Instantiate(bulletPrefab, muzzle.position, muzzle.rotation);
            b.GetComponent<Rigidbody>().AddForce(muzzle.forward * 30f, ForceMode.Impulse);
            Destroy(b, 2f);
        }

        private void OnTriggerEnter(Collider other)
        {
            if (other.CompareTag("Enemy"))
            {
                Hit?.Invoke(10);
                health.Damage(10);
                Debug.Log("player hit");
            }
        }
    }
}
