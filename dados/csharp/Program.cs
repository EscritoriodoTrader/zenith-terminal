using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Web.Script.Serialization;
using System.Globalization;

namespace MarketDataRTD
{
    [ComImport, Guid("A43788C1-D91B-11D3-8F39-00C04F3651B8"), InterfaceType(ComInterfaceType.InterfaceIsDual)]
    public interface IRTDUpdateEvent
    {
        void UpdateNotify();
        int HeartbeatInterval { get; set; }
        void Disconnect();
    }

    [ComVisible(true)]
    [Guid("A43788C2-D91B-11D3-8F39-00C04F3651B8")]
    [ClassInterface(ClassInterfaceType.None)]
    public class RTDCallback : IRTDUpdateEvent
    {
        public bool HasUpdates = false;

        public void UpdateNotify()
        {
            HasUpdates = true;
        }

        private int _heartbeatInterval = 1;
        public int HeartbeatInterval
        {
            get { return _heartbeatInterval; }
            set
            {
                Console.WriteLine("[C# NATIVO] Profit setou HeartbeatInterval: " + value + "ms");
                _heartbeatInterval = value;
            }
        }

        public void Disconnect() { }
    }

    class Program
    {
        // Canal fixo: T&T1
        const string CHANNEL = "T&T1";
        const int MAX_LINES = 500;

        [STAThread]
        static void Main(string[] args)
        {
            Console.WriteLine("[C# NATIVO] Inicializando Leitor de Alta Frequencia...");
            Console.WriteLine("[C# NATIVO] Canal: " + CHANNEL + " | Linhas: " + MAX_LINES);
            Console.WriteLine("[C# NATIVO] Pressione CTRL+C para sair.");

            RTDCallback callback = new RTDCallback();
            dynamic rtdServer = null;

            try
            {
                Type rtdType = Type.GetTypeFromProgID("rtdtrading.rtdserver");
                if (rtdType == null)
                {
                    Console.WriteLine("[ERRO] rtdtrading.rtdserver nao encontrado no registro do Windows.");
                    Console.ReadLine();
                    return;
                }

                rtdServer = Activator.CreateInstance(rtdType);

                // HeartbeatInterval = 1ms ANTES do ServerStart (igual ao Python)
                callback.HeartbeatInterval = 1;

                int startResult = rtdServer.ServerStart(callback);
                Console.WriteLine("[C# NATIVO] ServerStart retornou: " + startResult + " (1 = OK)");

                // Aguarda 500ms UMA ÚNICA VEZ para o Profit processar os ConnectData
                // Isso NÃO afeta o loop principal — é só na inicialização
                Thread.Sleep(500);

                // Mapa de topicId -> nome interno
                Dictionary<int, string> topicMap = new Dictionary<int, string>();
                bool newValues = true;

                // ID inicial aleatório para evitar cache da Nelogica
                int tid = (Environment.TickCount & int.MaxValue) % 100000000 + 10000;

                // Assina o nome do ativo no T&T1
                object[] assetArr = new object[] { CHANNEL, "INFO", "ATV" };
                try { rtdServer.ConnectData(tid, assetArr, ref newValues); } catch { }
                topicMap[tid] = "ASSET_NAME"; tid++;

                // Assina as 500 linhas do T&T1
                for (int i = 0; i < MAX_LINES; i++)
                {
                    string iStr = i.ToString();

                    object[] dat = new object[] { CHANNEL, "DAT",  iStr };
                    object[] pre = new object[] { CHANNEL, "PRE",  iStr };
                    object[] qul = new object[] { CHANNEL, "QUL",  iStr };
                    object[] agr = new object[] { CHANNEL, "AGR",  iStr };

                    try { rtdServer.ConnectData(tid, dat, ref newValues); } catch { }
                    topicMap[tid] = "DAT_" + iStr; tid++;

                    try { rtdServer.ConnectData(tid, pre, ref newValues); } catch { }
                    topicMap[tid] = "PRE_" + iStr; tid++;

                    try { rtdServer.ConnectData(tid, qul, ref newValues); } catch { }
                    topicMap[tid] = "QUL_" + iStr; tid++;

                    try { rtdServer.ConnectData(tid, agr, ref newValues); } catch { }
                    topicMap[tid] = "AGR_" + iStr; tid++;
                }

                Console.WriteLine("[C# NATIVO] " + (tid - 10000) + " topicos assinados no Profit.");

                // Primeira leitura forcada (igual ao _force_refresh do Python)
                System.Windows.Forms.Application.DoEvents();
                int cnt = 0;
                try
                {
                    object fr = rtdServer.RefreshData(ref cnt);
                    Console.WriteLine("[C# NATIVO] Primeira leitura: " + cnt + " topicos com dados.");
                }
                catch { }

                RunLoop(rtdServer, callback, topicMap);
            }
            catch (Exception ex)
            {
                Console.WriteLine("[FALHA FATAL]: " + ex.Message);
                Console.WriteLine(ex.StackTrace);
                Console.ReadLine();
            }
        }

        static void RunLoop(dynamic rtd, RTDCallback callback, Dictionary<int, string> topicMap)
        {
            // Cache de todos os valores do T&T1
            Dictionary<string, string> cache = new Dictionary<string, string>();

            // Estado anterior da tabela para o cálculo de deslizamento
            string[] lastTableState = new string[MAX_LINES];
            int[] oldQtys = new int[MAX_LINES];
            int sumOld = 0;

            HttpClient http = new HttpClient();
            http.Timeout = TimeSpan.FromSeconds(2);
            JavaScriptSerializer json = new JavaScriptSerializer();

            string assetName = "WINFUT";
            bool assetSubscribed = false;

            int totalReads = 0;
            long lastPrint = Environment.TickCount;

            // Dicionário global para manter a contagem de cada trade (evita mudança de IDs em tabelas rasgadas)
            Dictionary<string, int> globalTsCounters = new Dictionary<string, int>();
            int globalConsecutiveFails = 0;
            int globalLastTradesCount = 0;

            Console.WriteLine("[C# NATIVO] Loop iniciado. Aguardando dados do Replay...");

            while (true)
            {
                // Pump de mensagens Windows — essencial para COM STA
                System.Windows.Forms.Application.DoEvents();

                try
                {
                    int topicCount = 0;
                    object rawResult = rtd.RefreshData(ref topicCount);

                    if (topicCount > 0 && rawResult != null)
                    {
                        object[,] result = (object[,])rawResult;

                        // === PASSO 1: Atualiza o cache com os campos que mudaram ===
                        for (int i = 0; i < topicCount; i++)
                        {
                            int tid = Convert.ToInt32(result[0, i]);
                            if (!topicMap.ContainsKey(tid)) continue;

                            string name = topicMap[tid];
                            string val  = Convert.ToString(result[1, i]);
                            cache[name] = val;

                            // Detecta o ativo e assina ULT/VAR se ainda não fez
                            if (name == "ASSET_NAME" && !string.IsNullOrWhiteSpace(val) && val != "---")
                            {
                                if (val != assetName)
                                {
                                    assetName = val;
                                    assetSubscribed = false;
                                    Console.WriteLine("[C# NATIVO] Ativo detectado: " + assetName);
                                }

                                if (!assetSubscribed)
                                {
                                    assetSubscribed = true;
                                    bool nv = true;
                                    int ultTid = (Environment.TickCount & int.MaxValue) % 10000000 + 500000;
                                    int varTid = ultTid + 1;
                                    int negTid = ultTid + 2;
                                    try { rtd.ConnectData(ultTid, new object[] { assetName, "ULT" }, ref nv); } catch { }
                                    topicMap[ultTid] = "ULT";
                                    try { rtd.ConnectData(varTid, new object[] { assetName, "VAR" }, ref nv); } catch { }
                                    topicMap[varTid] = "VAR";
                                    try { rtd.ConnectData(negTid, new object[] { assetName, "NEG" }, ref nv); } catch { }
                                    topicMap[negTid] = "NEG";
                                    Console.WriteLine("[C# NATIVO] ULT/VAR/NEG assinados para " + assetName);
                                }
                            }
                        }

                        // === PASSO 2: Scan das 500 posições — encontra trades NOVOS ===
                        // O RTD empurra do topo para baixo: posição 0 = mais recente
                        // Pega a "fotografia" atual das 500 linhas
                        string[] currentTableState = new string[MAX_LINES];
                        int[] newQtys = new int[MAX_LINES];
                        int sumNew = 0;

                        for (int i = 0; i < MAX_LINES; i++)
                        {
                            string iStr = i.ToString();
                            string dat = cache.ContainsKey("DAT_" + iStr) ? cache["DAT_" + iStr] : "";
                            string pre = cache.ContainsKey("PRE_" + iStr) ? cache["PRE_" + iStr] : "";
                            string qul = cache.ContainsKey("QUL_" + iStr) ? cache["QUL_" + iStr] : "";
                            string agr = cache.ContainsKey("AGR_" + iStr) ? cache["AGR_" + iStr] : "";
                            
                            // Cria a linha
                            if (string.IsNullOrWhiteSpace(dat) || dat == "---" || dat.Contains("Inv") || string.IsNullOrWhiteSpace(pre)) 
                            {
                                currentTableState[i] = "";
                                newQtys[i] = 0;
                            }
                            else
                            {
                                currentTableState[i] = dat + "|" + pre + "|" + qul + "|" + agr;
                                int qty = 0;
                                int.TryParse(qul.Replace(".", "").Replace(",", ""), out qty);
                                newQtys[i] = qty;
                            }
                            sumNew += newQtys[i];
                        }
                        
                        int currentTradesCount = 0;
                        if (cache.ContainsKey("NEG"))
                            int.TryParse(cache["NEG"].Replace(".", "").Replace(",", ""), out currentTradesCount);

                        int newTradesCount = 0;
                        int candidateOffset = -1;
                        bool forceResync = false;

                        if (string.IsNullOrEmpty(lastTableState[0]))
                        {
                            for (int i = 0; i < MAX_LINES; i++)
                            {
                                if (!string.IsNullOrEmpty(currentTableState[i])) newTradesCount++;
                                else break;
                            }
                            forceResync = true;
                        }
                        else
                        {
                            string targetAnchor = lastTableState[0]; // A âncora agora é sempre o topo da nossa tabela perfeita
                            
                            for (int n = 0; n < MAX_LINES; n++)
                            {
                                Func<string, string, bool> TradesMatch = (s1, s2) => {
                                    if (s1 == s2) return true;
                                    if (string.IsNullOrEmpty(s1) || string.IsNullOrEmpty(s2)) return false;
                                    string[] p1 = s1.Split('|');
                                    string[] p2 = s2.Split('|');
                                    if (p1.Length >= 3 && p2.Length >= 3) return p1[0] == p2[0] && p1[1] == p2[1] && p1[2] == p2[2];
                                    return false;
                                };

                                if (TradesMatch(currentTableState[n], targetAnchor))
                                {
                                    bool match = true;
                                    int linesToCompare = Math.Min(100, MAX_LINES - n);
                                    int validMatches = 0;
                                    
                                    for (int k = 0; k < linesToCompare; k++)
                                    {
                                        string oldLine = lastTableState[k];
                                        string newLine = currentTableState[n + k];
                                        
                                        if (string.IsNullOrEmpty(oldLine) || string.IsNullOrEmpty(newLine)) 
                                        {
                                            if (n < 5) Console.WriteLine(string.Format("[C# DIAG] n={0} falhou no k={1}. oldLine ou newLine vazio.", n, k));
                                            match = false;
                                            break;
                                        }
                                            
                                        if (TradesMatch(newLine, oldLine))
                                        {
                                            validMatches++;
                                            // Se for diferente da âncora inicial, saímos com sucesso
                                            if (!TradesMatch(newLine, targetAnchor)) 
                                            {
                                                break;
                                            }
                                        }
                                        else
                                        {
                                            if (n < 5)
                                            {
                                                Console.WriteLine(string.Format("[C# DIAG] n={0} falhou no k={1}. oldLine: '{2}' | newLine: '{3}'", n, k, oldLine, newLine));
                                            }
                                            match = false;
                                            break;
                                        }
                                    }
                                    
                                    if (match && validMatches > 0)
                                    {
                                        candidateOffset = n;
                                        break;
                                    }
                                }
                            }

                            if (candidateOffset != -1)
                            {
                                newTradesCount = candidateOffset;
                                if (newTradesCount < 0) newTradesCount = 0; 
                                globalConsecutiveFails = 0; 
                            }
                            else
                            {
                                globalConsecutiveFails++;
                                if (globalConsecutiveFails > 15)
                                {
                                    int recoveredCount = currentTradesCount - globalLastTradesCount;
                                    if (recoveredCount < 0) recoveredCount = 0;
                                    if (recoveredCount > MAX_LINES) recoveredCount = MAX_LINES;

                                    Console.WriteLine(string.Format("[C# NATIVO] Sincronia perdida permanentemente. Recuperando {0} trades pelo contador NEG.", recoveredCount));
                                    
                                    newTradesCount = recoveredCount;
                                    globalConsecutiveFails = 0;
                                    forceResync = true;
                                }
                                else
                                {
                                    Console.WriteLine(string.Format("[C# NATIVO] Tabela corrompida pelo Profit (Tearing). Tentativa {0}. Ignorando tick...", globalConsecutiveFails));
                                    continue; 
                                }
                            }
                        }

                        // === Geração de IDs PERFEITOS (Memória Contínua) ===
                        // Nós usamos o cacheGlobal de contadores (passado para fora do tick) para que o seqN NUNCA mude para o mesmo trade.
                        string[] generatedIds = new string[MAX_LINES];
                        
                        // Processamos APENAS os trades confirmados como novos, varrendo do MAIS ANTIGO para o MAIS NOVO (bottom-up no bloco novo)
                        for (int i = newTradesCount - 1; i >= 0; i--)
                        {
                            if (string.IsNullOrEmpty(currentTableState[i])) continue;

                            string[] parts = currentTableState[i].Split('|');
                            if (parts.Length < 4) continue;

                            string dat = parts[0];
                            string pre = parts[1];
                            string qul = parts[2];
                            string agr = parts[3];

                            string side = "UNKNOWN";
                            string agrU = agr.ToUpper();
                            if (agrU.Contains("VEND") || agrU.StartsWith("S")) side = "SELL";
                            else if (agrU.Contains("COMP") || agrU.StartsWith("C")) side = "BUY";

                            double price = 0;
                            double.TryParse(pre.Replace(",", "."), NumberStyles.Any, CultureInfo.InvariantCulture, out price);
                            int qty = 0;
                            int.TryParse(qul.Replace(".", "").Replace(",", ""), out qty);

                            long unixMs = 0;
                            try
                            {
                                string timeStr = dat.Contains(" ") ? dat.Split(' ')[1] : dat; 
                                DateTime parsedTime;
                                if (DateTime.TryParseExact(timeStr, "HH:mm:ss.fff", CultureInfo.InvariantCulture, DateTimeStyles.None, out parsedTime))
                                {
                                    DateTime now = DateTime.Now;
                                    DateTime fullDate = new DateTime(now.Year, now.Month, now.Day, parsedTime.Hour, parsedTime.Minute, parsedTime.Second, parsedTime.Millisecond);
                                    if (fullDate > now.AddHours(2)) fullDate = fullDate.AddDays(-1);
                                    unixMs = new DateTimeOffset(fullDate).ToUnixTimeMilliseconds();
                                }
                            }
                            catch { }

                            if (unixMs == 0) continue;

                            string priceStr = price.ToString("0.##", CultureInfo.InvariantCulture);
                            string baseId = string.Format("{0}_{1}_{2}_{3}_{4}", assetName, side, unixMs, priceStr, qty);

                            // Atualiza o contador GLOBAL em memória para este trade base
                            if (!globalTsCounters.ContainsKey(baseId))
                            {
                                globalTsCounters[baseId] = 0;
                            }
                            globalTsCounters[baseId]++;

                            generatedIds[i] = string.Format("{0}_seq{1}", baseId, globalTsCounters[baseId]);
                        }

                        // Processa APENAS a quantidade de trades novos detectada pelo offset!
                        List<object> newTrades = new List<object>();
                        for (int i = 0; i < newTradesCount; i++)
                        {
                            if (string.IsNullOrEmpty(currentTableState[i]) || generatedIds[i] == null) continue;
                            
                            string[] parts = currentTableState[i].Split('|');
                            if (parts.Length < 4) continue;
                            
                            string dat = parts[0];
                            string pre = parts[1];
                            string qul = parts[2];
                            string agr = parts[3];

                            string side = "UNKNOWN";
                            string agrU = agr.ToUpper();
                            if (agrU.Contains("VEND") || agrU.StartsWith("S")) side = "SELL";
                            else if (agrU.Contains("COMP") || agrU.StartsWith("C")) side = "BUY";

                            double price = 0;
                            double.TryParse(pre.Replace(",", "."), NumberStyles.Any, CultureInfo.InvariantCulture, out price);
                            int qty = 0;
                            int.TryParse(qul.Replace(".", "").Replace(",", ""), out qty);

                            long unixMs = 0;
                            try
                            {
                                string timeStr = dat.Contains(" ") ? dat.Split(' ')[1] : dat;
                                DateTime parsedTime;
                                if (DateTime.TryParseExact(timeStr, "HH:mm:ss.fff", CultureInfo.InvariantCulture, DateTimeStyles.None, out parsedTime))
                                {
                                    DateTime now = DateTime.Now;
                                    DateTime fullDate = new DateTime(now.Year, now.Month, now.Day, parsedTime.Hour, parsedTime.Minute, parsedTime.Second, parsedTime.Millisecond);
                                    if (fullDate > now.AddHours(2)) fullDate = fullDate.AddDays(-1);
                                    unixMs = new DateTimeOffset(fullDate).ToUnixTimeMilliseconds();
                                }
                            }
                            catch { }

                            if (unixMs == 0) continue;

                            var trade = new Dictionary<string, object>();
                            trade["id"]        = generatedIds[i];
                            trade["timestamp"] = unixMs; 
                            trade["price"]     = price;
                            trade["quantity"]  = qty;
                            trade["side"]      = side;
                            trade["asset"]     = assetName;
                            newTrades.Add(trade);
                        }

                        // Salva o estado atual para ser a referência na próxima leitura
                        if (forceResync)
                        {
                            Array.Copy(currentTableState, lastTableState, MAX_LINES);
                        }
                        else
                        {
                            // Shifting Sintético perfeito! Imune ao Tearing do fundo da tabela do Profit.
                            if (newTradesCount > 0 && newTradesCount < MAX_LINES)
                            {
                                for (int i = MAX_LINES - 1; i >= newTradesCount; i--)
                                {
                                    lastTableState[i] = lastTableState[i - newTradesCount];
                                }
                                for (int i = 0; i < newTradesCount; i++)
                                {
                                    lastTableState[i] = currentTableState[i];
                                }
                            }
                        }
                        
                        Array.Copy(newQtys, oldQtys, MAX_LINES);
                        sumOld = sumNew;

                        // === PASSO 3: Envia os trades novos em UM único POST ===
                        if (newTrades.Count > 0)
                        {
                            double lastPrice = 0;
                            if (cache.ContainsKey("ULT"))
                                double.TryParse(cache["ULT"].Replace(",", "."), NumberStyles.Any, CultureInfo.InvariantCulture, out lastPrice);
                                
                            double variation = 0;
                            if (cache.ContainsKey("VAR"))
                                double.TryParse(cache["VAR"].Replace("%", "").Replace(",", "."), NumberStyles.Any, CultureInfo.InvariantCulture, out variation);

                            var payload = new Dictionary<string, object>();
                            payload["asset"] = assetName;
                            payload["lastPrice"] = lastPrice;
                            payload["variation"] = variation;
                            payload["tradesCount"] = currentTradesCount;
                            payload["data"]  = newTrades;

                            string jsonMsg = json.Serialize(payload);
                            var postContent = new StringContent(jsonMsg, Encoding.UTF8, "application/json");
                            http.PostAsync("http://127.0.0.1:3000/api/trades", postContent);
                            Console.WriteLine("[C# NATIVO] " + newTrades.Count + " trades novos -> Node.js. Ativo: " + assetName);
                        }

                        // Atualiza a memória global do número de trades (NEG) processados com sucesso
                        if (currentTradesCount > 0)
                        {
                            globalLastTradesCount = currentTradesCount;
                        }

                        totalReads += topicCount;
                    }
                }
                catch (Exception e)
                {
                    Console.WriteLine("[C# ERRO LOOP]: " + e.Message);
                }

                if (Environment.TickCount - lastPrint >= 5000)
                {
                    Console.WriteLine(string.Format("[C# NATIVO] Leituras de RTD: {0} nos ultimos 5 segundos.", totalReads));
                    totalReads = 0;
                    lastPrint = Environment.TickCount;
                }

                Thread.Sleep(1);
            }
        }
    }
}
    