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

                // >>> FORÇAR ASSINATURA DE NEG, ULT E VAR DIRETAMENTE NA INICIALIZAÇÃO <<<
                string fixedTicker = "WINFUT_F_0";
                
                object[] arrUlt = new object[] { fixedTicker, "ULT" };
                object[] arrVar = new object[] { fixedTicker, "VAR" };
                object[] arrNeg = new object[] { fixedTicker, "NEG" };
                
                try { rtdServer.ConnectData(tid, arrUlt, ref newValues); } catch (Exception e) { Console.WriteLine("Erro ULT: " + e.Message); }
                topicMap[tid] = "ULT"; tid++;
                
                try { rtdServer.ConnectData(tid, arrVar, ref newValues); } catch (Exception e) { Console.WriteLine("Erro VAR: " + e.Message); }
                topicMap[tid] = "VAR"; tid++;
                
                try { rtdServer.ConnectData(tid, arrNeg, ref newValues); } catch (Exception e) { Console.WriteLine("Erro NEG: " + e.Message); }
                topicMap[tid] = "NEG"; tid++;
                
                Console.WriteLine("[C# NATIVO] Assinaturas ULT/VAR/NEG enviadas para " + fixedTicker);

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

        static void RunLoop(dynamic rtd, RTDCallback callback, Dictionary<int, string> topicMap)
        {
            // Cache de todos os valores do T&T1
            Dictionary<string, string> cache = new Dictionary<string, string>();

            // Contador anterior de negócios para cálculo do diferencial
            int lastTradesCount = -1;

            // Guarda o último DAT_0 lido: só processa novos trades quando
            // AMBOS NEG avançou E a grid atualizou (DAT_0 mudou).
            // Isso evita ler dados antigos quando o NEG chega antes da grid.
            string lastDat0 = "";

            HttpClient http = new HttpClient();
            http.Timeout = TimeSpan.FromSeconds(2);
            JavaScriptSerializer json = new JavaScriptSerializer();

            string assetName = "WINFUT";


            int totalReads = 0;
            long lastPrint = Environment.TickCount;

            Console.WriteLine("[C# NATIVO] Loop iniciado. Aguardando dados do Replay...");

            while (true)
            {
                // Pump de mensagens Windows — essencial para COM STA
                System.Windows.Forms.Application.DoEvents();

                // === AGUARDA A CAMPANHIA DO PROFIT ===
                // Só chama RefreshData após o Profit tocar UpdateNotify().
                // Isso GARANTE que todos os tópicos do batch estão prontos
                // e consistentes (NEG + grid sincronizados).
                if (!callback.HasUpdates)
                {
                    Thread.Sleep(1); // aguarda sem consumir CPU
                    continue;
                }
                callback.HasUpdates = false; // reset antes de ler

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

                            // Apenas loga o ativo detectado (sem re-assinar).
                            // ULT/VAR/NEG já foram assinados permanentemente no Main().
                            // Re-assinar aqui cria um 2º tópico escrevendo em cache["NEG"],
                            // fazendo o NEG "voltar para trás" → duplicatas.
                            if (name == "ASSET_NAME" && !string.IsNullOrWhiteSpace(val) && val != "---")
                            {
                                if (val != assetName)
                                {
                                    assetName = val;
                                    Console.WriteLine("[C# NATIVO] Ativo detectado: " + assetName);
                                }
                            }
                        }

                        // === PASSO 2: Descobre a quantidade de trades novos pelo diferencial do NEG ===
                        int tradesCount = 0;
                        if (cache.ContainsKey("NEG"))
                        {
                            int.TryParse(cache["NEG"].Replace(".", "").Replace(",", ""), out tradesCount);
                        }

                        // Captura o DAT_0 atual (timestamp do trade mais novo na grid)
                        string currentDat0 = cache.ContainsKey("DAT_0") ? cache["DAT_0"] : "";

                        int newTradesCount = 0;
                        if (lastTradesCount == -1)
                        {
                            // Primeira leitura: tentar inferir visualmente quantos estão preenchidos
                            for (int i = 0; i < MAX_LINES; i++)
                            {
                                string iStr = i.ToString();
                                string dat = cache.ContainsKey("DAT_" + iStr) ? cache["DAT_" + iStr] : "";
                                string pre = cache.ContainsKey("PRE_" + iStr) ? cache["PRE_" + iStr] : "";
                                if (!string.IsNullOrWhiteSpace(dat) && dat != "---" && !dat.Contains("Inv") && !string.IsNullOrWhiteSpace(pre))
                                    newTradesCount++;
                                else
                                    break;
                            }
                            if (tradesCount > 0) lastTradesCount = tradesCount;
                            lastDat0 = currentDat0;

                            string msgBase = string.Format("[CÁLCULO INICIAL] Leitura Base. Valor atual NEG: {0}. Trades carregados da tela: {1}", tradesCount, newTradesCount);
                            Console.WriteLine(msgBase);
                            try { System.IO.File.AppendAllText(@"c:\FOOTPRINT\dados\logs\rtd_audit.log", DateTime.Now.ToString("HH:mm:ss.fff") + " - " + msgBase + Environment.NewLine); } catch { }
                        }
                        else
                        {
                            if (tradesCount > lastTradesCount)
                            {
                                // SINCRONIZAÇÃO: só lê se a grid também atualizou (DAT_0 mudou).
                                // Se NEG chegou antes da grid, aguarda o próximo tick.
                                if (!string.IsNullOrEmpty(currentDat0) && currentDat0 == lastDat0)
                                {
                                    // Grid ainda não atualizou. NEG acumulará e será lido quando DAT_0 mudar.
                                }
                                else
                                {
                                    newTradesCount = tradesCount - lastTradesCount;
                                    string msgCalc = string.Format("[CÁLCULO] NEG Atual: {0} | NEG Anterior: {1} | DAT_0: {2} -> Lendo {3} novos trades na tela.", tradesCount, lastTradesCount, currentDat0, newTradesCount);
                                    Console.WriteLine(msgCalc);
                                    try { System.IO.File.AppendAllText(@"c:\FOOTPRINT\dados\logs\rtd_audit.log", DateTime.Now.ToString("HH:mm:ss.fff") + " - " + msgCalc + Environment.NewLine); } catch { }

                                    if (newTradesCount > MAX_LINES)
                                    {
                                        newTradesCount = MAX_LINES;
                                        Console.WriteLine("[C# NATIVO] Tsunami detectado via diferença de NEG!");
                                        try { System.IO.File.AppendAllText(@"c:\FOOTPRINT\dados\logs\rtd_audit.log", DateTime.Now.ToString("HH:mm:ss.fff") + " - [C# NATIVO] Tsunami detectado via diferença de NEG!" + Environment.NewLine); } catch { }
                                    }
                                    lastTradesCount = tradesCount;
                                    lastDat0 = currentDat0;
                                }
                            }
                            else if (tradesCount < lastTradesCount && tradesCount > 0)
                            {
                                // NEG voltou para trás — RTD heartbeat enviou valor antigo do cache.
                                // ESTRATÉGIA: ignorar completamente. Manter o high-water mark (lastTradesCount).
                                // Quando o NEG genuíno avançar além do high-water mark, será processado normalmente.
                                // NÃO atualizar lastTradesCount nem lastDat0.
                                string msgRewind = string.Format("[AVISO] NEG voltou de {0} para {1}. Ignorando (cache RTD). Mantendo baseline em {0}.", lastTradesCount, tradesCount);
                                Console.WriteLine(msgRewind);
                                try { System.IO.File.AppendAllText(@"c:\FOOTPRINT\dados\logs\rtd_audit.log", DateTime.Now.ToString("HH:mm:ss.fff") + " - " + msgRewind + Environment.NewLine); } catch { }
                            }
                        }

                        // Processa APENAS a quantidade de trades novos detectada pelo diferencial!
                        List<object> newTrades = new List<object>();
                        for (int i = 0; i < newTradesCount; i++)
                        {
                            string iStr = i.ToString();
                            string dat = cache.ContainsKey("DAT_" + iStr) ? cache["DAT_" + iStr] : "";
                            string pre = cache.ContainsKey("PRE_" + iStr) ? cache["PRE_" + iStr] : "";
                            string qul = cache.ContainsKey("QUL_" + iStr) ? cache["QUL_" + iStr] : "";
                            string agr = cache.ContainsKey("AGR_" + iStr) ? cache["AGR_" + iStr] : "";

                            if (string.IsNullOrWhiteSpace(dat) || string.IsNullOrWhiteSpace(pre) || dat == "---") continue;
                            
                            // Determina lado (comprador/vendedor agressor)
                            string side = "UNKNOWN";
                            string agrU = agr.ToUpper();
                            if (agrU.Contains("VEND") || agrU.StartsWith("S")) side = "SELL";
                            else if (agrU.Contains("COMP") || agrU.StartsWith("C")) side = "BUY";

                            // Converte preco e quantidade
                            double price = 0;
                            double.TryParse(pre.Replace(",", "."), NumberStyles.Any, CultureInfo.InvariantCulture, out price);
                            int qty = 0;
                            int.TryParse(qul.Replace(".", "").Replace(",", ""), out qty);

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
                                    if (fullDate > now.AddHours(2)) fullDate = fullDate.AddDays(-1);
                                    unixMs = new DateTimeOffset(fullDate).ToUnixTimeMilliseconds();
                                }
                            }
                            catch { }

                            if (unixMs == 0) continue;

                            globalTradeSeq++;
                            // UID baseado na POSIÇÃO NEG do trade na bolsa (único e determinístico)
                            // Trade na posição i do batch corresponde ao NEG = (tradesCount - i)
                            // Isso garante unicidade real (dois trades idênticos em ms/preço/qty/lado
                            // têm NEG diferentes) e deduplicação correta (mesmo trade relido = mesmo NEG).
                            string uid = string.Format("{0}_neg{1}", assetName, tradesCount - i);



                            var trade = new Dictionary<string, object>();
                            trade["id"]        = uid;
                            trade["timestamp"] = unixMs; 
                            trade["price"]     = price;
                            trade["quantity"]  = qty;
                            trade["side"]      = side;
                            trade["asset"]     = assetName;
                            newTrades.Add(trade);
                        }

                        // === PASSO 3: Envia os trades novos em UM único POST ===
                        if (newTrades.Count > 0)
                        {
                            // Inverte a lista para ordem cronológica (antigo -> novo)

                            double lastPrice = 0;
                            if (cache.ContainsKey("ULT"))
                                double.TryParse(cache["ULT"].Replace(",", "."), NumberStyles.Any, CultureInfo.InvariantCulture, out lastPrice);
                                
                            double variation = 0;
                            if (cache.ContainsKey("VAR"))
                                double.TryParse(cache["VAR"].Replace("%", "").Replace(",", "."), NumberStyles.Any, CultureInfo.InvariantCulture, out variation);

                            int tradesCountPayload = 0;
                            if (cache.ContainsKey("NEG"))
                                int.TryParse(cache["NEG"].Replace(".", "").Replace(",", ""), out tradesCountPayload);

                            var payload = new Dictionary<string, object>();
                            payload["asset"] = assetName;
                            payload["lastPrice"] = lastPrice;
                            payload["variation"] = variation;
                            payload["tradesCount"] = tradesCountPayload;
                            payload["data"]  = newTrades;

                            string jsonMsg = json.Serialize(payload);
                            // FIRE AND FORGET: dispara o POST e volta IMEDIATAMENTE para o RTD
                            // Não bloqueia o loop — zero delay de leitura
                            var postContent = new StringContent(jsonMsg, Encoding.UTF8, "application/json");
                            http.PostAsync("http://127.0.0.1:3000/api/trades", postContent);
                            Console.WriteLine("[C# NATIVO] " + newTrades.Count + " trades novos -> Node.js. Ativo: " + assetName);
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
