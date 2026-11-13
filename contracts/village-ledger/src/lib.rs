//! Emberwick Village Ledger
//!
//! An append-only record of what the village of Emberwick did each day:
//! * `state`:   SHA-256 of the public village state at the end of a game day
//!              (the exact JSON is served by the game at /api/state-records)
//! * `ai_plan`: SHA-256 of the craftsmen's morning plan from NEAR AI Cloud
//!              (the exact JSON is served at /api/ai/plan?day=N), with the model,
//!              whether a TEE attestation report was received, and whether the
//!              answer's signature was checked against the attested key.
//!
//! Only the village bank (`writer`) can add records. A record, once written, can
//! never be changed or removed: the contract has no method for it, and the game
//! deletes this account's own access key after setup, so its code cannot be
//! replaced either. Anyone can read every record with the view methods.

use near_sdk::store::{LookupMap, Vector};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault};

pub const KINDS: [&str; 2] = ["state", "ai_plan"];
const MAX_TEXT: usize = 64;
const MAX_PAGE: u32 = 50;

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum Key {
    Entries,
    Order,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    /// "state" or "ai_plan"
    pub kind: String,
    /// game day the record is about
    pub day: u32,
    /// lowercase hex SHA-256 of the exact JSON the game serves for that day
    pub sha256: String,
    /// NEAR AI model (ai_plan only)
    pub model: Option<String>,
    /// a TEE attestation report was received for the model (ai_plan only)
    pub tee: Option<bool>,
    /// the answer's signature was verified against a key in the attestation report (ai_plan only)
    pub signed: Option<bool>,
    /// address that signed the answer inside the TEE (ai_plan only)
    pub signer: Option<String>,
    /// position in the ledger, starting at 0
    pub seq: u32,
    /// when it was written (nanoseconds) and in which block
    pub recorded_at_ns: u64,
    pub block_height: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct VillageLedger {
    writer: AccountId,
    entries: LookupMap<String, Entry>,
    order: Vector<String>,
}

fn key(kind: &str, day: u32) -> String {
    format!("{kind}:{day}")
}

fn short(field: &str, v: &Option<String>) {
    if let Some(s) = v {
        require!(!s.is_empty() && s.len() <= MAX_TEXT, format!("{field} must be 1..{MAX_TEXT} characters"));
        require!(s.chars().all(|c| c.is_ascii_graphic()), format!("{field} must be plain ASCII without spaces"));
    }
}

#[near]
impl VillageLedger {
    #[init]
    pub fn new(writer: AccountId) -> Self {
        Self { writer, entries: LookupMap::new(Key::Entries), order: Vector::new(Key::Order) }
    }

    /// Add one record. Only the writer (the village bank) may call this, and only once per kind and day.
    #[allow(clippy::too_many_arguments)]
    pub fn record(
        &mut self,
        kind: String,
        day: u32,
        sha256: String,
        model: Option<String>,
        tee: Option<bool>,
        signed: Option<bool>,
        signer: Option<String>,
    ) -> Entry {
        require!(env::predecessor_account_id() == self.writer, "only the village bank can write to the ledger");
        require!(KINDS.contains(&kind.as_str()), "kind must be \"state\" or \"ai_plan\"");
        require!(
            sha256.len() == 64 && sha256.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)),
            "sha256 must be 64 lowercase hex characters"
        );
        short("model", &model);
        short("signer", &signer);
        if kind == "state" {
            require!(model.is_none() && tee.is_none() && signed.is_none() && signer.is_none(), "a state record carries only the hash");
        }
        let k = key(&kind, day);
        require!(!self.entries.contains_key(&k), "this day is already recorded; records cannot be changed");
        let entry = Entry {
            kind,
            day,
            sha256,
            model,
            tee,
            signed,
            signer,
            seq: self.order.len(),
            recorded_at_ns: env::block_timestamp(),
            block_height: env::block_height(),
        };
        self.entries.insert(k.clone(), entry.clone());
        self.order.push(k);
        env::log_str(&format!(
            "EVENT_JSON:{}",
            near_sdk::serde_json::json!({
                "standard": "emberwick_ledger",
                "version": "1.0.0",
                "event": "recorded",
                "data": [{ "kind": entry.kind, "day": entry.day, "sha256": entry.sha256, "seq": entry.seq }]
            })
        ));
        entry
    }

    /// The record for one kind and day, if there is one.
    pub fn get(&self, kind: String, day: u32) -> Option<Entry> {
        self.entries.get(&key(&kind, day)).cloned()
    }

    /// Records in the order they were written, starting at `from` (at most 50).
    pub fn list(&self, from: u32, limit: u32) -> Vec<Entry> {
        let end = from.saturating_add(limit.min(MAX_PAGE)).min(self.order.len());
        (from..end).filter_map(|i| self.order.get(i).and_then(|k| self.entries.get(k)).cloned()).collect()
    }

    /// The newest records first (at most 50).
    pub fn latest(&self, limit: u32) -> Vec<Entry> {
        let n = self.order.len();
        let take = limit.min(MAX_PAGE).min(n);
        (0..take).filter_map(|i| self.order.get(n - 1 - i).and_then(|k| self.entries.get(k)).cloned()).collect()
    }

    pub fn count(&self) -> u32 {
        self.order.len()
    }

    pub fn writer(&self) -> AccountId {
        self.writer.clone()
    }

    pub fn version(&self) -> String {
        env!("CARGO_PKG_VERSION").to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{get_logs, VMContextBuilder};
    use near_sdk::testing_env;

    fn bank() -> AccountId {
        "emberwick-village.testnet".parse().unwrap()
    }
    fn ctx(who: &AccountId, height: u64) {
        testing_env!(VMContextBuilder::new().predecessor_account_id(who.clone()).block_height(height).block_timestamp(height * 1_000_000_000).build());
    }
    const H1: &str = "8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4";
    const H2: &str = "0000000000000000000000000000000000000000000000000000000000000001";

    #[test]
    fn writes_and_reads_back() {
        ctx(&bank(), 10);
        let mut l = VillageLedger::new(bank());
        let e = l.record("state".into(), 3, H1.into(), None, None, None, None);
        assert_eq!(e.seq, 0);
        assert_eq!(e.block_height, 10);
        ctx(&bank(), 11);
        l.record("ai_plan".into(), 4, H2.into(), Some("deepseek/deepseek-v3.2".into()), Some(true), Some(true), Some("0xabc".into()));
        assert_eq!(l.count(), 2);
        assert_eq!(l.get("state".into(), 3).unwrap().sha256, H1);
        let p = l.get("ai_plan".into(), 4).unwrap();
        assert_eq!((p.tee, p.signed, p.signer.as_deref()), (Some(true), Some(true), Some("0xabc")));
        assert!(l.get("state".into(), 4).is_none());
        assert_eq!(l.latest(10).iter().map(|e| e.day).collect::<Vec<_>>(), vec![4, 3]);
        assert_eq!(l.list(1, 10).len(), 1);
        assert_eq!(l.list(5, 10).len(), 0);
        assert!(get_logs().iter().any(|x| x.starts_with("EVENT_JSON:") && x.contains("\"recorded\"")));
    }

    #[test]
    #[should_panic(expected = "only the village bank")]
    fn nobody_else_can_write() {
        ctx(&bank(), 1);
        let mut l = VillageLedger::new(bank());
        ctx(&"someone.testnet".parse().unwrap(), 2);
        l.record("state".into(), 1, H1.into(), None, None, None, None);
    }

    #[test]
    #[should_panic(expected = "records cannot be changed")]
    fn a_day_cannot_be_rewritten() {
        ctx(&bank(), 1);
        let mut l = VillageLedger::new(bank());
        l.record("state".into(), 1, H1.into(), None, None, None, None);
        l.record("state".into(), 1, H2.into(), None, None, None, None);
    }

    #[test]
    #[should_panic(expected = "64 lowercase hex")]
    fn rejects_a_bad_hash() {
        ctx(&bank(), 1);
        let mut l = VillageLedger::new(bank());
        l.record("state".into(), 1, "ABC".into(), None, None, None, None);
    }

    #[test]
    #[should_panic(expected = "kind must be")]
    fn rejects_an_unknown_kind() {
        ctx(&bank(), 1);
        let mut l = VillageLedger::new(bank());
        l.record("price".into(), 1, H1.into(), None, None, None, None);
    }

    #[test]
    #[should_panic(expected = "only the hash")]
    fn a_state_record_has_no_ai_fields() {
        ctx(&bank(), 1);
        let mut l = VillageLedger::new(bank());
        l.record("state".into(), 1, H1.into(), Some("m".into()), None, None, None);
    }

    #[test]
    fn same_day_both_kinds_and_page_limit() {
        ctx(&bank(), 1);
        let mut l = VillageLedger::new(bank());
        for d in 0..60 {
            l.record("state".into(), d, H1.into(), None, None, None, None);
        }
        l.record("ai_plan".into(), 0, H2.into(), None, Some(false), Some(false), None);
        assert_eq!(l.count(), 61);
        assert_eq!(l.latest(500).len(), 50);
        assert_eq!(l.list(0, 500).len(), 50);
        assert_eq!(l.latest(1)[0].kind, "ai_plan");
    }
}
