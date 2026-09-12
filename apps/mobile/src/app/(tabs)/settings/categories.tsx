import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { Stack, router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { listRows } from "@kopiyka/core";
import { useQuery } from "@/store";
import { Card, CategoryIcon, Empty, Row, ScreenNote } from "@/components/ui";
import { BarButton, BottomBar } from "@/components/BottomBar";
import { C, S } from "@/constants/theme";

/** Folders and their categories; tap any row to edit it. Add lives in the thumb zone. */
export default function CategoriesScreen() {
  const groups = useQuery((db) => {
    const all = listRows(db, "categories", "deleted=0", [], "sort, name");
    const parents = all.filter((c) => !c.parent_id);
    const orphans = all.filter((c) => c.parent_id && !parents.some((p) => p.id === c.parent_id));
    return { list: parents.map((p) => ({ parent: p, children: all.filter((c) => c.parent_id === p.id) })), orphans };
  });
  const add = () => Alert.alert("Add", undefined, [
    { text: "New category", onPress: () => router.push({ pathname: "/category/edit", params: { id: "new", parent: groups.list[0]?.parent.id ?? "" } }) },
    { text: "New folder", onPress: () => router.push({ pathname: "/category/edit", params: { id: "new", folder: "1" } }) },
    { text: "Cancel", style: "cancel" },
  ]);
  return (
    <>
      <Stack.Screen options={{ title: "Categories" }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 180 }}>
        <ScreenNote>A category is what money was spent on, and it is what budgets and every chart are built from. A folder groups categories and is never filed into: a transaction always goes to one of the categories inside it. Give a folder a colour and the categories created in it take that colour.</ScreenNote>
        {groups.list.length === 0 ? <Empty title="No categories" hint="Add a folder, then categories inside it." /> : null}
        {groups.list.map(({ parent, children }) => (
          <Card key={parent.id} style={{ marginTop: S.lg }}>
            <Row title={parent.name} subtitle={`Folder${parent.kind === "income" ? " · income" : ""} · ${children.length} categor${children.length === 1 ? "y" : "ies"}`}
              onPress={() => router.push({ pathname: "/category/edit", params: { id: parent.id } })}
              right={<View style={styles.right}><CategoryIcon name={parent.name} icon={parent.icon} color={parent.color} size={30} /><SymbolView name="chevron.right" size={13} tintColor={C.tertiary} /></View>} />
            {children.map((c) => <Row key={c.id} title={c.name} onPress={() => router.push({ pathname: "/category/edit", params: { id: c.id } })} style={[styles.divider, styles.child]}
              right={<View style={styles.right}><CategoryIcon name={c.name} icon={c.icon} color={c.color} size={26} /><SymbolView name="chevron.right" size={13} tintColor={C.tertiary} /></View>} />)}
            <Row title="Add category here" onPress={() => router.push({ pathname: "/category/edit", params: { id: "new", parent: parent.id } })} style={[styles.divider, styles.child, { opacity: 0.7 }]} />
          </Card>
        ))}
        {groups.orphans.length ? (
          <Card style={{ marginTop: S.lg }}>
            {groups.orphans.map((c, i) => <Row key={c.id} title={c.name} subtitle="No folder" onPress={() => router.push({ pathname: "/category/edit", params: { id: c.id } })} style={i > 0 ? styles.divider : undefined} />)}
          </Card>
        ) : null}
      </ScrollView>
      <BottomBar><BarButton icon="plus" label="Add" onPress={add} a11y="Add" /></BottomBar>
    </>
  );
}

const styles = StyleSheet.create({
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  child: { paddingLeft: S.xl + 8 },
  right: { flexDirection: "row", alignItems: "center", gap: 8 },
});
