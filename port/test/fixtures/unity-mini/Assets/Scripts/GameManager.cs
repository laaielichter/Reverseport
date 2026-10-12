using System.Collections;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace MiniHeli
{
    public class GameManager : MonoBehaviour
    {
        public static GameManager Instance { get; private set; }
        public int score;

        void Awake()
        {
            if (Instance != null) { Destroy(gameObject); return; }
            Instance = this;
            DontDestroyOnLoad(gameObject);
        }

        public void PlayerDied()
        {
            StartCoroutine(Restart());
        }

        IEnumerator Restart()
        {
            yield return new WaitForSeconds(1.5f);
            SceneManager.LoadScene("Main");
        }
    }
}
