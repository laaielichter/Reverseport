using System;
using System.Collections;
using UnityEngine;

[RequireComponent(typeof(CharacterController))]
public class Player : MonoBehaviour
{
    public event Action<int> Hit;

    [SerializeField] private float speed = 6f;
    [SerializeField] private float jumpVelocity = 4.5f;
    [SerializeField] private Animator anim;
    [SerializeField] private Transform muzzle;
    [SerializeField] private GameObject bulletPrefab;

    private CharacterController controller;
    private Vector3 velocity;

    void Awake()
    {
        controller = GetComponent<CharacterController>();
        Hit += OnHit;
    }

    void OnDestroy() { Hit -= OnHit; }

    void FixedUpdate()
    {
        if (!controller.isGrounded) velocity += Physics.gravity * Time.fixedDeltaTime;
        velocity.x = Input.GetAxis("Horizontal") * speed;
        if (Input.GetButtonDown("Fire1")) Shoot();
        controller.Move(velocity * Time.fixedDeltaTime);
    }

    public void Shoot()
    {
        Instantiate(bulletPrefab, muzzle.position, muzzle.rotation);
        if (anim != null) anim.Play("shoot");
    }

    public void TakeHit(int damage) => Hit?.Invoke(damage);

    void OnHit(int damage)
    {
        Global.Instance.AddScore(-damage);
        if (damage > 50) StartCoroutine(FreeLater(0.5f));
    }

    IEnumerator FreeLater(float seconds)
    {
        yield return new WaitForSeconds(seconds);
        Destroy(gameObject);
    }
}
