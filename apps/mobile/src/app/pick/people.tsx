import { useMemo, useState } from "react";
import { Alert, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { createPerson, listPeople, save, type Person } from "@kopiyka/core";
import { mutate, useQuery } from "@/store";
import { resolvePick } from "@/store/pick";
import { PickerHeader, PickerList, Tap } from "@/components/ui";
import { PersonAvatar } from "@/components/PersonAvatar";
import { C, S, themed } from "@/constants/theme";
import { t } from "@/i18n";

/**
 * Who was there: friends to split with, or to take on an event. Resolves the chosen person ids.
 *
 * Anyone can be added by typing their name — nobody has to be in Contacts. "From Contacts" opens the
 * system's own picker, which hands over only the one contact tapped and needs no permission; the
 * name is what is kept (and the contact's id, only to recognise them if they are picked again).
 * The ones picked most often come first, so a group you go out with is three taps at the top.
 */
export default function PickPeople() {
  const { key, selected } = useLocalSearchParams<{ key: string; selected?: string }>();
  const initial = useMemo(() => new Set(selected ? selected.split(",").filter(Boolean) : []), [selected]);
  const [chosen, setChosen] = useState<string[]>(() => [...initial]);
  const [q, setQ] = useState("");
  const people = useQuery((db) => {
    const uses = new Map(db.all<{ person_id: string; n: number }>(
      `SELECT person_id, COUNT(*) AS n FROM transactions WHERE deleted=0 AND person_id IS NOT NULL GROUP BY person_id`).map((r) => [r.person_id, r.n]));
    return listPeople(db).map((p) => ({ ...p, uses: uses.get(p.id) ?? 0 }))
      .sort((a, b) => Number(initial.has(b.id)) - Number(initial.has(a.id)) || b.uses - a.uses || a.sort - b.sort);
  }, [initial]);
  const name = q.trim();
  const filtered = name ? people.filter((p) => p.name.toLowerCase().includes(name.toLowerCase())) : people;
  const canCreate = !!name && !people.some((p) => p.name.toLowerCase() === name.toLowerCase());
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const pickNew = (p: Person) => { setChosen((c) => (c.includes(p.id) ? c : [...c, p.id])); setQ(""); };
  const create = () => { if (canCreate) pickNew(mutate((db) => createPerson(db, { name }))); };

  const fromContacts = async () => {
    try {
      // Loaded on tap: nothing about Contacts runs until someone asks for it.
      const { Contact } = await import("expo-contacts");
      const contact = await Contact.presentPicker();
      if (!contact) return;
      const full = (await contact.getFullName()).trim();
      if (!full) return;
      const known = people.find((p) => p.contact_id === contact.id) ?? people.find((p) => p.name.toLowerCase() === full.toLowerCase());
      if (known) {
        // Picked from Contacts after being typed by hand: now it is the same person either way.
        if (!known.contact_id) mutate((db) => save(db, "people", { ...known, contact_id: contact.id }));
        pickNew(known);
        return;
      }
      pickNew(mutate((db) => createPerson(db, { name: full, contact_id: contact.id })));
    } catch {
      Alert.alert(t("people.pick.contactsFailed"));
    }
  };

  // A name typed but not added yet is the friend being asked for: Done adds them rather than losing it.
  const done = () => {
    const ids = canCreate ? [...chosen, mutate((db) => createPerson(db, { name })).id] : chosen;
    resolvePick(key, ids);
    router.back();
  };

  return (
    <PickerList data={filtered} keyExtractor={(p) => p.id} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets
      header={
        <PickerHeader title={t("people.pick.title")} done={{ onPress: done, count: chosen.length + (canCreate ? 1 : 0) }}>
          <View style={styles.search}>
            <SymbolView name="person.badge.plus" size={16} tintColor={C.tertiary} />
            <TextInput value={q} onChangeText={setQ} placeholder={t("people.pick.search")} placeholderTextColor={C.tertiary} style={styles.input}
              autoCorrect={false} autoCapitalize="words" textContentType="name" onSubmitEditing={canCreate ? create : done} returnKeyType={canCreate ? "default" : "done"}
              accessibilityLabel={t("people.pick.searchA11y")} />
          </View>
          {canCreate ? (
            <Tap onPress={create} style={styles.row} accessibilityRole="button">
              <SymbolView name="plus.circle" size={22} tintColor={C.tint} />
              <Text style={[styles.name, { color: C.tint }]}>{t("people.pick.add", { name })}</Text>
            </Tap>
          ) : null}
          <Tap onPress={() => void fromContacts()} style={styles.row} accessibilityRole="button">
            <SymbolView name="person.crop.circle.badge.plus" size={22} tintColor={C.tint} />
            <Text style={[styles.name, { color: C.tint }]}>{t("people.pick.contacts")}</Text>
          </Tap>
        </PickerHeader>
      }
      renderItem={({ item: p }) => {
        const on = chosen.includes(p.id);
        return (
          <Tap onPress={() => toggle(p.id)} style={styles.row} accessibilityRole="button" accessibilityLabel={p.name} accessibilityState={{ selected: on }}>
            <PersonAvatar person={p} />
            <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
            <SymbolView name={on ? "checkmark.circle.fill" : "circle"} size={22} tintColor={on ? C.tint : C.tertiary} />
          </Tap>
        );
      }}
      ListEmptyComponent={name ? null : <Text style={styles.empty}>{t("people.pick.empty")}</Text>}
    />
  );
}

const styles = themed(() => StyleSheet.create({
  search: { flexDirection: "row", alignItems: "center", gap: S.sm, marginHorizontal: S.lg, marginTop: S.sm, marginBottom: S.xs, paddingHorizontal: S.md, height: 44, borderRadius: 12, backgroundColor: C.fill },
  input: { flex: 1, fontSize: 17, color: C.label, height: 44 },
  row: { flexDirection: "row", alignItems: "center", gap: S.md, paddingHorizontal: S.xl, minHeight: 52 },
  name: { flex: 1, fontSize: 17, color: C.label },
  empty: { fontSize: 15, color: C.secondary, textAlign: "center", padding: S.xl },
}));
