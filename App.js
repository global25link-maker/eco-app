import { useEffect, useState } from "react";
import {
  View, Text, TextInput, Pressable, FlatList, StyleSheet, SafeAreaView, StatusBar, Platform,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FS from "expo-file-system/legacy";
import {
  useAudioRecorder, useAudioRecorderState, useAudioPlayer, useAudioPlayerStatus,
  RecordingPresets, AudioModule, setAudioModeAsync,
} from "expo-audio";

const WEB = Platform.OS === "web";
const KEY = "eco:audios";
const DIR = FS.documentDirectory + "eco/";
const C = { bg: "#e9efec", ink: "#10302a", muted: "#5b7068", card: "#f8fbf9", line: "#c9d6d0", rec: "#e03a22" };
const fmt = (s = 0) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function Item({ a, playingId, setPlayingId, onRename, onDelete }) {
  const player = useAudioPlayer(a.uri);
  const st = useAudioPlayerStatus(player);
  const [name, setName] = useState(a.name);
  const [confirming, setConfirming] = useState(false);

  // Só uma gravação de cada vez: se outra começou, esta pausa
  useEffect(() => {
    if (playingId !== a.id && st.playing) player.pause();
  }, [playingId]);

  const toggle = () => {
    if (st.playing) {
      player.pause();
      setPlayingId(null);
      return;
    }
    if (st.duration && st.currentTime >= st.duration - 0.1) player.seekTo(0);
    setPlayingId(a.id);
    player.play();
  };

  return (
    <View style={s.item}>
      <View style={s.row}>
        <TextInput
          style={s.rename}
          value={name}
          onChangeText={setName}
          onEndEditing={() => name.trim() && name !== a.name && onRename(a.id, name.trim())}
        />
        <Text style={s.meta}>{fmt(a.duration)}</Text>
      </View>
      <View style={s.row}>
        <Pressable style={s.play} onPress={toggle}>
          <Text style={s.playTxt}>{st.playing ? "Pausar" : "Ouvir"}</Text>
        </Pressable>
        <Text style={s.meta}>{new Date(a.createdAt).toLocaleDateString("pt")}</Text>
        {confirming ? (
          <View style={{ flexDirection: "row", gap: 14 }}>
            <Pressable onPress={() => onDelete(a)}>
              <Text style={[s.link, { color: C.rec, fontWeight: "700" }]}>Confirmar</Text>
            </Pressable>
            <Pressable onPress={() => setConfirming(false)}>
              <Text style={s.link}>Cancelar</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => setConfirming(true)}>
            <Text style={[s.link, { color: C.rec }]}>Apagar</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export default function App() {
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState(null); // { uri, duration }
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [playingId, setPlayingId] = useState(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const rs = useAudioRecorderState(recorder, 250);

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => v && setItems(JSON.parse(v)));
  }, []);
  const persist = (list) => {
    setItems(list);
    return AsyncStorage.setItem(KEY, JSON.stringify(list));
  };

  const start = async () => {
    setError("");
    setPlayingId(null); // pára qualquer reprodução antes de gravar
    const p = await AudioModule.requestRecordingPermissionsAsync();
    if (!p.granted) return setError("Sem acesso ao microfone. Permita nas definições.");
    if (!WEB) await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
  };
  const stop = async () => {
    const duration = (rs.durationMillis || 0) / 1000;
    await recorder.stop();
    if (!WEB) await setAudioModeAsync({ allowsRecording: false });
    setDraft({ uri: recorder.uri, duration });
    setName(`Gravação ${items.length + 1}`);
  };
  const save = async () => {
    const id = String(Date.now());
    let dest;
    if (WEB) {
      // Na web não há sistema de ficheiros: guardamos o áudio como texto (base64)
      const blob = await (await fetch(draft.uri)).blob();
      dest = await new Promise((res) => {
        const r = new FileReader();
        r.onloadend = () => res(r.result);
        r.readAsDataURL(blob);
      });
    } else {
      await FS.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
      const ext = draft.uri.split(".").pop() || "m4a";
      dest = `${DIR}${id}.${ext}`;
      await FS.copyAsync({ from: draft.uri, to: dest });
    }
    await persist([
      { id, name: name.trim() || "Sem nome", uri: dest, duration: draft.duration, createdAt: Date.now() },
      ...items,
    ]);
    setDraft(null);
  };
  const remove = async (a) => {
    const next = items.filter((x) => x.id !== a.id);
    if (playingId === a.id) setPlayingId(null);
    setItems(next); // a gravação sai da lista logo
    try {
      if (!WEB) await FS.deleteAsync(a.uri, { idempotent: true });
      await AsyncStorage.setItem(KEY, JSON.stringify(next));
    } catch (e) {}
  };
  const rename = (id, n) => persist(items.map((x) => (x.id === id ? { ...x, name: n } : x)));

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="dark-content" />
      <FlatList
        data={items}
        keyExtractor={(a) => a.id}
        contentContainerStyle={s.pad}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <Text style={s.title}>Eco</Text>
            <Text style={s.sub}>Grave a sua voz. Fica guardada neste dispositivo.</Text>

            <View style={s.stage}>
              <Pressable
                style={s.rec}
                onPress={rs.isRecording ? stop : start}
                disabled={!!draft}
                accessibilityLabel={rs.isRecording ? "Parar gravação" : "Iniciar gravação"}
              >
                <View style={[s.glyph, rs.isRecording && { borderRadius: 6 }]} />
              </Pressable>
              <Text style={s.time}>{fmt(draft ? draft.duration : (rs.durationMillis || 0) / 1000)}</Text>
              <Text style={s.meta}>
                {draft ? "Gravação concluída" : rs.isRecording ? "A gravar…" : "Toque para gravar"}
              </Text>
              {!!error && <Text style={s.error}>{error}</Text>}
            </View>

            {draft && (
              <View style={s.save}>
                <Text style={s.label}>Nome da gravação</Text>
                <TextInput style={s.input} value={name} onChangeText={setName} autoFocus />
                <View style={s.row}>
                  <Pressable style={s.primary} onPress={save}><Text style={s.primaryTxt}>Guardar</Text></Pressable>
                  <Pressable onPress={() => setDraft(null)}><Text style={s.link}>Descartar</Text></Pressable>
                </View>
              </View>
            )}
            <Text style={s.h2}>Gravações {items.length > 0 ? `(${items.length})` : ""}</Text>
          </View>
        }
        ListEmptyComponent={<Text style={s.meta}>Ainda não há gravações. Toque no botão vermelho para começar.</Text>}
        renderItem={({ item }) => (
          <Item a={item} playingId={playingId} setPlayingId={setPlayingId} onRename={rename} onDelete={remove} />
        )}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  pad: { padding: 20, paddingTop: 36, paddingBottom: 60 },
  title: { fontSize: 48, fontWeight: "800", color: C.ink, letterSpacing: -2 },
  sub: { color: C.muted, marginTop: 2 },
  stage: { alignItems: "center", paddingVertical: 32, gap: 8 },
  rec: { width: 120, height: 120, borderRadius: 60, backgroundColor: C.rec, borderWidth: 4, borderColor: C.ink, alignItems: "center", justifyContent: "center" },
  glyph: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#fff" },
  time: { fontSize: 40, fontWeight: "600", color: C.ink, fontVariant: ["tabular-nums"] },
  meta: { color: C.muted, fontSize: 13 },
  error: { color: C.rec, textAlign: "center" },
  save: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 16, gap: 10, marginBottom: 24 },
  label: { fontWeight: "600", color: C.ink },
  input: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: 8, padding: 10, color: C.ink, fontSize: 16 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  primary: { backgroundColor: C.ink, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 20 },
  primaryTxt: { color: C.bg, fontWeight: "600" },
  link: { color: C.ink, textDecorationLine: "underline" },
  h2: { fontSize: 18, fontWeight: "600", color: C.ink, marginBottom: 12 },
  item: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 14, gap: 10, marginBottom: 12 },
  rename: { flex: 1, fontWeight: "600", fontSize: 16, color: C.ink, padding: 0 },
  play: { backgroundColor: C.ink, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 16 },
  playTxt: { color: C.bg, fontWeight: "600" },
});
