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

        // ═══════════════════════════════════════════════════════
        // MODO DIAGNÓSTICO CIRÚRGICO
        // Ligue para estudar a dessincronização NEG vs grade RTD.
        // Gera: dados\logs\sync_diag.log  (não polui o console)
        // Desligue (false) em produção para máxima performance.
        // ═══════════════════════════════════════════════════════
        const bool DIAG_MODE = true;
        static readonly string DIAG_FILE = System.IO.Path.Combine(
            AppDomain.CurrentDomain.BaseDirectory, @"..\logs\sync_diag.log");

        static readonly object _diagLock = new object();
        static void DiagLog(string line)
        {
            if (!DIAG_MODE) return;
            string entry = DateTime.Now.ToString("HH:mm:ss.fff") + " " + line;
            Console.WriteLine("[DIAG] " + line); // Espelha no terminal também
            lock (_diagLock)
            {
                try { System.IO.File.AppendAllText(DIAG_FILE, entry + "\r\n"); }
                catch { }
            }
        }

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

        static long globalTradeSeq = 0;

        static double ParseProfitNumber(string val)
        {
            if (string.IsNullOrWhiteSpace(val) || val == "---") return 0;
            val = val.Trim().Replace("%", "");
            if (val.Contains(",") && val.Contains("."))
                val = val.Replace(".", "").Replace(",", ".");
            else if (val.Contains(","))
                val = val.Replace(",", ".");
            
            double result;
            double.TryParse(val, NumberStyles.Any, CultureInfo.InvariantCulture, out result);
            return result;
        }

        static void RunLoop(dynamic rtd, RTDCallback callback, Dictionary<int, string> topicMap)
        {
            // Cache de todos os valores do T&T1
            Dictionary<string, string> cache = new Dictionary<string, string>();

            // NEG Puro: usa apenas o contador de negócios da bolsa para detectar trades novos
            int lastNeg = -1;

            // DIAGNÓSTICO: fingerprint do último lote enviado para detectar duplicatas exatas
            string lastBatchFingerprint = "";
            long lastNegChangeMs = 0; // Momento exato em que o NEG moveu

            HttpClient http = new HttpClient();
            http.Timeout = TimeSpan.FromSeconds(2);
            JavaScriptSerializer json = new JavaScriptSerializer();

            string assetName = "WINFUT";
            bool assetSubscribed = false;

            int totalReads = 0;
            long lastPrint = Environment.TickCount;

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

                                    string infoAsset = assetName;
                                    if (assetName.StartsWith("ES") || assetName.StartsWith("NQ"))
                                    {
                                        infoAsset = assetName + "_M_0";
                                    }

                                    try { rtd.ConnectData(ultTid, new object[] { infoAsset, "ULT" }, ref nv); } catch { }
                                    topicMap[ultTid] = "ULT";
                                    try { rtd.ConnectData(varTid, new object[] { infoAsset, "VAR" }, ref nv); } catch { }
                                    topicMap[varTid] = "VAR";
                                    try { rtd.ConnectData(negTid, new object[] { infoAsset, "NEG" }, ref nv); } catch { }
                                    topicMap[negTid] = "NEG";
                                    Console.WriteLine("[C# NATIVO] ULT/VAR/NEG assinados para " + infoAsset);
                                }
                            }
                        }

                        // === PASSO 2: NEG Puro com Alinhamento ===
                        // Princípio: confia 100% no NEG como contador oficial da bolsa.
                        // Quando NEG sobe K → aguarda 6ms para o Profit preencher a grade → lê as K primeiras linhas.
                        // Sem janela deslizante, sem âncora, sem retry. Simples e sem duplicatas.
                        int currentNeg = 0;
                        if (cache.ContainsKey("NEG"))
                            currentNeg = (int)ParseProfitNumber(cache["NEG"]);

                        int newTradesCount = 0;
                        bool proceedToProcess = false;

                        if (lastNeg < 0)
                        {
                            // Inicialização: registra o NEG base sem processar nada
                            lastNeg = currentNeg;
                            Console.WriteLine("[C# NEG] Base inicial estabelecida. NEG=" + currentNeg);
                        }
                        else if (currentNeg > lastNeg)
                        {
                            int delta = currentNeg - lastNeg;
                            lastNeg = currentNeg;
                            lastNegChangeMs = Environment.TickCount;

                            // DIAGNÓSTICO PRÉ-SLEEP: captura o estado STALE da grade
                            // (o que o cache tem ANTES de esperar o Profit preencher)
                            string dat0Pre = cache.ContainsKey("DAT_0") ? cache["DAT_0"] : "(vazio)";
                            string dat1Pre = cache.ContainsKey("DAT_1") ? cache["DAT_1"] : "(vazio)";
                            string dat2Pre = cache.ContainsKey("DAT_2") ? cache["DAT_2"] : "(vazio)";

                            if (DIAG_MODE)
                                DiagLog(string.Format("NEG+{0} (NEG={1}) | PRÉ-SLEEP | DAT[0]={2} | DAT[1]={3} | DAT[2]={4}",
                                    delta, currentNeg, dat0Pre, dat1Pre, dat2Pre));

                            // ALINHAMENTO: aguarda o Profit preencher a grade RTD com os novos trades.
                            Thread.Sleep(6);

                            // LEITURA FRESCA: chama RefreshData novamente para capturar os dados
                            // que o Profit acabou de escrever na grade durante o delay.
                            // Sem isso, o cache abaixo estaria stale (dados de antes do NEG mover).
                            System.Windows.Forms.Application.DoEvents();
                            int freshCount = 0;
                            try
                            {
                                object freshResult = rtd.RefreshData(ref freshCount);
                                if (freshCount > 0 && freshResult != null)
                                {
                                    object[,] freshData = (object[,])freshResult;
                                    for (int fi = 0; fi < freshCount; fi++)
                                    {
                                        int ftid = Convert.ToInt32(freshData[0, fi]);
                                        if (!topicMap.ContainsKey(ftid)) continue;
                                        cache[topicMap[ftid]] = Convert.ToString(freshData[1, fi]);
                                    }
                                }
                            }
                            catch { }

                            // DIAGNÓSTICO PÓS-REFRESH: captura o estado FRESCO da grade
                            // Compara com PRÉ para provar se o Sleep(6ms) foi suficiente
                            string dat0Pos = cache.ContainsKey("DAT_0") ? cache["DAT_0"] : "(vazio)";
                            string dat1Pos = cache.ContainsKey("DAT_1") ? cache["DAT_1"] : "(vazio)";
                            string dat2Pos = cache.ContainsKey("DAT_2") ? cache["DAT_2"] : "(vazio)";
                            bool dadoMudou = (dat0Pos != dat0Pre);
                            long elapsed = Environment.TickCount - lastNegChangeMs;

                            if (DIAG_MODE)
                                DiagLog(string.Format("NEG+{0} | PÓS-REFRESH | freshTopics={1} | dadoMudou={2} | elapsedMs={3} | DAT[0]={4} | DAT[1]={5} | DAT[2]={6}",
                                    delta, freshCount, dadoMudou ? "SIM" : "NÃO(STALE!)", elapsed, dat0Pos, dat1Pos, dat2Pos));

                            newTradesCount = Math.Min(delta, MAX_LINES);
                            proceedToProcess = true;

                            if (delta > MAX_LINES)
                                Console.WriteLine("[C# NEG] Rajada de " + delta + " trades — limitado a " + MAX_LINES + ". Perda de " + (delta - MAX_LINES) + " (limite do Profit).");
                        }

                        if (!proceedToProcess)
                        {
                            // Nenhum trade novo — aguarda o próximo ciclo sem gastar CPU
                            Thread.Sleep(1);
                            continue;
                        }

                        // Fotografia da tabela com dados FRESCOS (pós segundo RefreshData)
                        string[] currentTableState = new string[MAX_LINES];
                        for (int i = 0; i < newTradesCount; i++)
                        {
                            string iStr = i.ToString();
                            string dat = cache.ContainsKey("DAT_" + iStr) ? cache["DAT_" + iStr] : "";
                            string pre = cache.ContainsKey("PRE_" + iStr) ? cache["PRE_" + iStr] : "";
                            string qul = cache.ContainsKey("QUL_" + iStr) ? cache["QUL_" + iStr] : "";
                            string agr = cache.ContainsKey("AGR_" + iStr) ? cache["AGR_" + iStr] : "";

                            if (string.IsNullOrWhiteSpace(dat) || dat == "---" || dat.Contains("Inv") || string.IsNullOrWhiteSpace(pre))
                                currentTableState[i] = "";
                            else
                                currentTableState[i] = dat + "|" + pre + "|" + qul + "|" + agr;
                        }

                        // Processa as linhas confirmadas pelo NEG (as primeiras newTradesCount da tabela)
                        List<object> newTrades = new List<object>();
                        for (int i = 0; i < newTradesCount; i++)
                        {
                            if (string.IsNullOrEmpty(currentTableState[i])) continue;
                            
                            string[] parts = currentTableState[i].Split('|');
                            if (parts.Length < 4) continue;
                            
                            string dat = parts[0];
                            string pre = parts[1];
                            string qul = parts[2];
                            string agr = parts[3];

                            // Determina lado (comprador/vendedor agressor)
                            string side = "UNKNOWN";
                            string agrU = agr.ToUpper();
                            if (agrU.Contains("VEND") || agrU.StartsWith("S")) side = "SELL";
                            else if (agrU.Contains("COMP") || agrU.StartsWith("C")) side = "BUY";

                            // Converte preco e quantidade
                            double price = ParseProfitNumber(pre);
                            int qty = (int)ParseProfitNumber(qul);

                            // Converte a string de tempo (ex: "10:11:45.661") para Unix Epoch ms
                            long unixMs = 0;
                            try
                            {
                                string timeStr = dat.Contains(" ") ? dat.Split(' ')[1] : dat; // Remove data se houver
                                DateTime parsedTime;
                                if (DateTime.TryParseExact(timeStr, "HH:mm:ss.fff", CultureInfo.InvariantCulture, DateTimeStyles.None, out parsedTime))
                                {
                                    DateTime now = DateTime.Now;
                                    DateTime fullDate = new DateTime(now.Year, now.Month, now.Day, parsedTime.Hour, parsedTime.Minute, parsedTime.Second, parsedTime.Millisecond);
                                    // Se a hora do trade for 2 horas a mais que agora, provavelmente é do dia anterior (virada da noite)
                                    if (fullDate > now.AddHours(2)) fullDate = fullDate.AddDays(-1);
                                    unixMs = new DateTimeOffset(fullDate).ToUnixTimeMilliseconds();
                                }
                            }
                            catch { }

                            // Se a hora for inválida ou "-" o Profit bugou na linha, ignoramos para não dar erro no banco
                            if (unixMs == 0) continue;

                            globalTradeSeq++;
                            string uid = string.Format("{0}_{1}_{2}_{3}_{4}_seq{5}", assetName, unixMs, price, qty, side, globalTradeSeq);

                            var trade = new Dictionary<string, object>();
                            trade["id"]        = uid;
                            trade["timestamp"] = unixMs; 
                            trade["price"]     = price;
                            trade["quantity"]  = qty;
                            trade["side"]      = side;
                            trade["asset"]     = assetName;
                            newTrades.Add(trade);
                        }

                        // O rastreio agora é feito pelo NEG — não há mais necessidade de salvar estado da tabela

                        // === PASSO 3: Envia os trades novos em UM único POST ===
                        if (newTrades.Count > 0)
                        {
                            // DIAGNÓSTICO: fingerprint do lote para detectar duplicatas exatas
                            if (DIAG_MODE)
                            {
                                var sb = new StringBuilder();
                                sb.Append("LOTE " + newTrades.Count + " trades | ");
                                foreach (var t in newTrades)
                                {
                                    var td = (Dictionary<string, object>)t;
                                    sb.Append(td["timestamp"] + "@" + td["price"] + "x" + td["quantity"] + td["side"] + " | ");
                                }
                                string batchFp = sb.ToString();
                                bool isDuplicate = (batchFp == lastBatchFingerprint);
                                DiagLog((isDuplicate ? "⚠️ DUPLICATA EXATA! " : "✅ LOTE NOVO | ") + batchFp);
                                lastBatchFingerprint = batchFp;
                            }

                            double lastPrice = 0;
                            if (cache.ContainsKey("ULT"))
                                lastPrice = ParseProfitNumber(cache["ULT"]);
                                
                            double variation = 0;
                            if (cache.ContainsKey("VAR"))
                                variation = ParseProfitNumber(cache["VAR"]);

                            int tradesCount = 0;
                            if (cache.ContainsKey("NEG"))
                                tradesCount = (int)ParseProfitNumber(cache["NEG"]);

                            var payload = new Dictionary<string, object>();
                            payload["asset"] = assetName;
                            payload["lastPrice"] = lastPrice;
                            payload["variation"] = variation;
                            payload["tradesCount"] = tradesCount;
                            payload["data"]  = newTrades;

                            string jsonMsg = json.Serialize(payload);
                            // FIRE AND FORGET: dispara o POST e volta IMEDIATAMENTE para o RTD
                            // Não bloqueia o loop — zero delay de leitura
                            var postContent = new StringContent(jsonMsg, Encoding.UTF8, "application/json");
                            http.PostAsync("http://127.0.0.1:3000/api/trades", postContent);
                            Console.WriteLine("[C# NATIVO] " + newTrades.Count + " trades novos -> Node.js. Ativo: " + assetName);
                        }

                        totalReads += topicCount;

                        // THROTTLE INTELIGENTE: Em modo ultra-frequência, dá 2ms extra ao Profit para
                        // consolidar a grade antes do próximo RefreshData — reduz data-tearing significativamente.
                        // Só aplica quando há muitos tópicos mudando ao mesmo tempo (explosão de mercado).
                        if (topicCount > 500)
                        {
                            Thread.Sleep(2);
                        }
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
