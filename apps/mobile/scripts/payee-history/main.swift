// Swift half of the payee-history parity harness: answers the questions in questions.json with the
// real KPStore code, so the copy that runs with the app closed can be compared against core's.
// See README.md — run it through run.sh, never on its own.
import Foundation
import SQLite3

let args = CommandLine.arguments
guard args.count == 3, let data = FileManager.default.contents(atPath: args[1]),
      let questions = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
  FileHandle.standardError.write("usage: payee-history <questions.json> <actual.json>\n".data(using: .utf8)!)
  exit(2)
}

func opt(_ v: Any?) -> Any { (v as? String).flatMap { $0.isEmpty ? nil : $0 } ?? NSNull() }
func json(_ h: KPStore.PayeeHistory) -> [String: Any] {
  ["category_id": h.categoryId ?? NSNull(), "tag_ids": h.tagIds,
   "place": h.place ?? NSNull(), "lat": h.lat ?? NSNull(), "lon": h.lon ?? NSNull()]
}

var out: [String: Any] = [:]

out["history"] = (questions["history"] as? [[String: Any]] ?? []).map { q in
  json(KPStore.localPayeeHistory(payee: q["payee"] as? String, note: q["note"] as? String) ?? .none)
}

out["payment"] = (questions["payment"] as? [[String: Any]] ?? []).map { q -> [String: Any] in
  let ctx = KPStore.localPaymentContext(accountId: q["account_id"] as! String, amountMinor: q["amount_minor"] as! Int,
                                        payee: q["payee"] as? String, note: nil,
                                        withinMinutes: q["within_minutes"] as! Int) ?? KPStore.PaymentContext()
  let twin: Any = ctx.twin.map { t -> [String: Any] in
    ["id": t.id, "payee": t.payee ?? NSNull(), "place": t.place ?? NSNull(),
     "category_id": t.categoryId ?? NSNull(), "pending": t.pending ? 1 : 0]
  } ?? NSNull()
  return ["history": json(ctx.history), "twin": twin]
}

out["fill"] = (questions["fill"] as? [[String: Any]] ?? []).map { q -> Any in
  let id = q["id"] as! String
  KPStore.fillIn(id: id, payee: q["payee"] as? String, place: q["place"] as? String, categoryId: q["category_id"] as? String,
                 tagIds: q["tag_ids"] as? [String] ?? [], lat: q["lat"] as? Double, lon: q["lon"] as? Double,
                 confirm: q["confirm"] as? Bool ?? false)
  return KPStore.row(id) ?? NSNull()
}

let encoded = try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys, .prettyPrinted])
try encoded.write(to: URL(fileURLWithPath: args[2]))

// Reading one row back is only ever needed here, so it lives with the harness rather than in KPShared.
extension KPStore {
  static func row(_ id: String) -> [String: Any]? {
    withDatabase { db -> [String: Any]? in
      var stmt: OpaquePointer?
      let T = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
      guard sqlite3_prepare_v2(db, "SELECT id, payee, place, category_id, tag_ids, lat, lon, pending FROM transactions WHERE id=?", -1, &stmt, nil) == SQLITE_OK else { return nil }
      defer { sqlite3_finalize(stmt) }
      sqlite3_bind_text(stmt, 1, id, -1, T)
      guard sqlite3_step(stmt) == SQLITE_ROW else { return nil }
      func text(_ i: Int32) -> Any {
        sqlite3_column_type(stmt, i) == SQLITE_NULL ? NSNull() : String(cString: sqlite3_column_text(stmt, i))
      }
      func real(_ i: Int32) -> Any {
        sqlite3_column_type(stmt, i) == SQLITE_NULL ? NSNull() : sqlite3_column_double(stmt, i)
      }
      return ["id": text(0), "payee": text(1), "place": text(2), "category_id": text(3),
              "tag_ids": text(4), "lat": real(5), "lon": real(6), "pending": Int(sqlite3_column_int(stmt, 7))]
    }
  }
}
