using System;
using UnityEngine;

// Autoload "Global" → singleton that survives scene loads.
public class Global : MonoBehaviour
{
    public static Global Instance { get; private set; }
    public event Action<int> ScoreChanged;
    public int Score { get; private set; }

    void Awake()
    {
        if (Instance != null) { Destroy(gameObject); return; }
        Instance = this;
        DontDestroyOnLoad(gameObject);
    }

    public void AddScore(int points)
    {
        Score += points;
        ScoreChanged?.Invoke(Score);
    }
}
