// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.37;

/// @title RetirementRegistry
/// @notice Refuses a second on-chain retirement of the same carbon credit (ICVCM criterion 6.2, no double use),
/// and records 32-byte anchors so the same contract can serve as an EVM anchor for Grounding's signed records.
///
/// A credit series is named by the issuing registry and the registry's own series id (for example a project,
/// vintage and batch prefix); credits in a series are numbered serials. A retirement covers an inclusive serial
/// range [first, last]. Within a series, retired ranges are kept as a sorted linked list keyed by their first
/// serial, so an overlapping range, including the exact same range or a single serial inside an earlier range,
/// reverts. The caller passes the first serial of the retired range just below the new one (0 if none) as a
/// hint; the contract checks the hint, so a wrong hint reverts and cannot let an overlap through. The hint keeps
/// every retirement O(1) in gas however many ranges a series holds. A unit with no numeric serial is a series
/// of its own with first = last = 1.
///
/// What it cannot do: stop a registry from issuing the same tonne twice under two series ids, or stop the same
/// credit being retired off-chain. It only refuses a second on-chain retirement of overlapping serials.
///
/// There are no tokens, payments or owner. Anyone may record, and the registry's name is part of the key, so a
/// record says who claimed it (`recorder`) and not that the registry agreed. A real deployment would restrict
/// recorders to the registries themselves, as a consortium: the Climate Action Data Trust (CAD Trust) is the
/// real-world precedent, a shared metadata layer that registries publish their issuances and retirements to.
contract RetirementRegistry {
    struct Retirement {
        bytes32 seriesKey;
        uint256 first;
        uint256 last;
        bytes32 claimDigest;
        bytes32 evidence;
        address recorder;
        uint256 time;
    }

    /// seriesKey => first serial of a retired range => last serial of that range (0 = no range starts here).
    mapping(bytes32 => mapping(uint256 => uint256)) public lastOf;
    /// seriesKey => first serial of a range (0 = list head) => first serial of the next range (0 = end).
    mapping(bytes32 => mapping(uint256 => uint256)) public nextOf;
    mapping(bytes32 => Retirement) public retirements;

    event Retired(bytes32 indexed unitKey, bytes32 claimDigest, address recorder, uint256 time);
    event Anchored(bytes32 indexed digest, address sender, uint256 time);

    error EmptyRange(uint256 first, uint256 last);
    error AlreadyRetired(bytes32 seriesKey, uint256 first, uint256 last);
    error BadHint(uint256 hintPrev);

    function seriesKey(string calldata registry, string calldata series) public pure returns (bytes32) {
        return keccak256(abi.encode(registry, series));
    }

    function unitKey(bytes32 series, uint256 first, uint256 last) public pure returns (bytes32) {
        return keccak256(abi.encode(series, first, last));
    }

    /// @param claimDigest hash of the beneficiary claim (who retired it, for what).
    /// @param evidence digest of the evidence record (e.g. Grounding's anchored digest) or a CID's multihash digest.
    function retire(
        string calldata registry,
        string calldata series,
        uint256 first,
        uint256 last,
        uint256 hintPrev,
        bytes32 claimDigest,
        bytes32 evidence
    ) external returns (bytes32 key) {
        if (first == 0 || last < first) revert EmptyRange(first, last);
        bytes32 s = seriesKey(registry, series);

        if (hintPrev != 0) {
            uint256 prevLast = lastOf[s][hintPrev];
            if (prevLast == 0) revert BadHint(hintPrev);
            if (hintPrev <= last && prevLast >= first) revert AlreadyRetired(s, hintPrev, prevLast);
            if (hintPrev > first) revert BadHint(hintPrev);
        }
        uint256 nxt = nextOf[s][hintPrev];
        if (nxt != 0) {
            if (nxt <= last && lastOf[s][nxt] >= first) revert AlreadyRetired(s, nxt, lastOf[s][nxt]);
            if (nxt < first) revert BadHint(hintPrev);
        }

        nextOf[s][first] = nxt;
        nextOf[s][hintPrev] = first;
        lastOf[s][first] = last;

        key = unitKey(s, first, last);
        retirements[key] = Retirement(s, first, last, claimDigest, evidence, msg.sender, block.timestamp);
        emit Retired(key, claimDigest, msg.sender, block.timestamp);
    }

    function anchor(bytes32 digest) external {
        emit Anchored(digest, msg.sender, block.timestamp);
    }
}
