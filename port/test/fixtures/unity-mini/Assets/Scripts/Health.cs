using UnityEngine;
using UnityEngine.Events;

namespace MiniHeli
{
    public class Health : MonoBehaviour
    {
        public int max = 100;
        public UnityEvent onDeath;
        int current;

        void Start() { current = max; }

        public void Damage(int amount)
        {
            current -= amount;
            if (current <= 0)
            {
                onDeath?.Invoke();
                GameManager.Instance.PlayerDied();
            }
        }
    }
}
