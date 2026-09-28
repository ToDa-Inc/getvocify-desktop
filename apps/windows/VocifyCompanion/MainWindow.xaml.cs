using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Windows;
using NAudio.Wave;

namespace VocifyCompanion;

public partial class MainWindow : Window
{
    private string _token = "";
    private readonly StringBuilder _final = new();
    private ClientWebSocket? _socket;
    private WaveInEvent? _mic;
    private WasapiLoopbackCapture? _loopback;
    private CancellationTokenSource? _listen;

    public MainWindow()
    {
        InitializeComponent();
    }

    private async void Login_Click(object sender, RoutedEventArgs e)
    {
        Status.Text = "";
        try
        {
            using var http = new HttpClient();
            var body = JsonSerializer.Serialize(new { email = Email.Text.Trim(), password = Password.Password });
            var response = await http.PostAsync(
                ApiRoot() + "/auth/login",
                new StringContent(body, Encoding.UTF8, "application/json"));
            var raw = await response.Content.ReadAsStringAsync();
            if (!response.IsSuccessStatusCode)
            {
                Status.Text = raw;
                return;
            }
            using var doc = JsonDocument.Parse(raw);
            _token = doc.RootElement.GetProperty("access_token").GetString() ?? "";
            Status.Text = "Sesión lista.";
        }
        catch (Exception ex)
        {
            Status.Text = ex.Message;
        }
    }

    private async void Listen_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrEmpty(_token))
        {
            Status.Text = "Entra primero.";
            return;
        }
        _listen = new CancellationTokenSource();
        _final.Clear();
        Transcript.Text = "";
        var uri = new Uri(ApiRoot().Replace("https://", "wss://").Replace("http://", "ws://")
            + "/transcription/live?language=multi&mode=copilot_channels&channel_labels=prospect,rep");
        _socket = new ClientWebSocket();
        _socket.Options.SetRequestHeader("Authorization", "Bearer " + _token);
        await _socket.ConnectAsync(uri, _listen.Token);
        _ = Receive(_listen.Token);
        _mic = new WaveInEvent { WaveFormat = new WaveFormat(16000, 16, 1) };
        _mic.DataAvailable += (_, args) => SendPcm("rep", args.Buffer, args.BytesRecorded);
        _mic.StartRecording();
        _loopback = new WasapiLoopbackCapture();
        _loopback.DataAvailable += (_, args) => SendPcm("prospect", args.Buffer, args.BytesRecorded);
        _loopback.StartRecording();
        Status.Text = "Escuchando.";
    }

    private async void Stop_Click(object sender, RoutedEventArgs e)
    {
        _mic?.StopRecording();
        _loopback?.StopRecording();
        _listen?.Cancel();
        if (_socket?.State == WebSocketState.Open)
        {
            await _socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "stop", CancellationToken.None);
        }
        var transcript = _final.ToString().Trim();
        if (transcript.Length == 0)
        {
            Status.Text = "No hay transcripción.";
            return;
        }
        using var http = new HttpClient();
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _token);
        var body = JsonSerializer.Serialize(new { transcript, source_type = "meeting_transcript" });
        var response = await http.PostAsync(
            ApiRoot() + "/memos/upload-and-extract",
            new StringContent(body, Encoding.UTF8, "application/json"));
        Status.Text = response.IsSuccessStatusCode ? "Enviado a Vocify." : await response.Content.ReadAsStringAsync();
    }

    private void SendPcm(string channel, byte[] buffer, int count)
    {
        if (_socket?.State != WebSocketState.Open) return;
        var slice = new byte[count];
        Buffer.BlockCopy(buffer, 0, slice, 0, count);
        var json = JsonSerializer.Serialize(new
        {
            type = "AddChannelAudio",
            channel,
            data = Convert.ToBase64String(slice),
        });
        var bytes = Encoding.UTF8.GetBytes(json);
        _ = _socket.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None);
    }

    private async Task Receive(CancellationToken cancel)
    {
        var buffer = new byte[8192];
        while (_socket?.State == WebSocketState.Open && !cancel.IsCancellationRequested)
        {
            var result = await _socket.ReceiveAsync(buffer, cancel);
            if (result.MessageType != WebSocketMessageType.Text) continue;
            var text = Encoding.UTF8.GetString(buffer, 0, result.Count);
            try
            {
                using var doc = JsonDocument.Parse(text);
                if (doc.RootElement.GetProperty("type").GetString() != "Results") continue;
                var line = doc.RootElement.GetProperty("channel")
                    .GetProperty("alternatives")[0]
                    .GetProperty("transcript").GetString() ?? "";
                var final = doc.RootElement.TryGetProperty("is_final", out var flag) && flag.GetBoolean();
                if (!final || line.Length == 0) continue;
                _final.Append(' ').Append(line);
                Dispatcher.Invoke(() => Transcript.Text = _final.ToString().Trim());
            }
            catch
            {
                // ignore partial frames
            }
        }
    }

    private string ApiRoot()
    {
        var raw = ApiBase.Text.Trim().TrimEnd('/');
        return raw.Length == 0 ? "https://api.getvocify.com/api/v1" : raw;
    }
}
