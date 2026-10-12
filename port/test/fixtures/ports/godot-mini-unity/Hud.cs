using TMPro;
using UnityEngine;

public class Hud : MonoBehaviour
{
    [SerializeField] private TMP_Text label;

    void Start() { Global.Instance.ScoreChanged += OnScoreChanged; }
    void OnDestroy() { if (Global.Instance != null) Global.Instance.ScoreChanged -= OnScoreChanged; }

    void OnScoreChanged(int newScore)
    {
        label.text = $"Score: {newScore}";
    }
}
