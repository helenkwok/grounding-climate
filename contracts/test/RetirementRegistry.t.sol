// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.37;

import {RetirementRegistry} from "../src/RetirementRegistry.sol";

// The few Foundry cheatcodes used, declared here so the tests need no forge-std dependency.
interface Vm {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }

    function expectRevert(bytes calldata revertData) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
    function warp(uint256 newTimestamp) external;
}

contract RetirementRegistryTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    RetirementRegistry reg;
    bytes32 constant CLAIM = keccak256("beneficiary claim");
    bytes32 constant EVIDENCE = keccak256("evidence");

    function setUp() public {
        reg = new RetirementRegistry();
    }

    function retire(string memory series, uint256 first, uint256 last, uint256 hint) internal returns (bytes32) {
        return reg.retire("acr", series, first, last, hint, CLAIM, EVIDENCE);
    }

    function test_FirstRetirementRecordsAndEmits() public {
        vm.warp(1_790_000_000);
        vm.recordLogs();
        bytes32 key = retire("ACR123-2020", 1, 100, 0);

        bytes32 s = reg.seriesKey("acr", "ACR123-2020");
        require(key == keccak256(abi.encode(s, uint256(1), uint256(100))), "unit key");
        (bytes32 rs, uint256 first, uint256 last, bytes32 claim, bytes32 ev, address recorder, uint256 time) =
            reg.retirements(key);
        require(rs == s && first == 1 && last == 100, "stored range");
        require(claim == CLAIM && ev == EVIDENCE && recorder == address(this) && time == 1_790_000_000, "stored");

        Vm.Log[] memory logs = vm.getRecordedLogs();
        require(logs.length == 1 && logs[0].emitter == address(reg), "one log");
        require(logs[0].topics[0] == RetirementRegistry.Retired.selector && logs[0].topics[1] == key, "topics");
        (bytes32 c, address r, uint256 t) = abi.decode(logs[0].data, (bytes32, address, uint256));
        require(c == CLAIM && r == address(this) && t == 1_790_000_000, "event data");
    }

    function test_SecondRetirementOfSameUnitReverts() public {
        retire("ACR123-2020", 1, 100, 0);
        bytes32 s = reg.seriesKey("acr", "ACR123-2020");
        vm.expectRevert(abi.encodeWithSelector(RetirementRegistry.AlreadyRetired.selector, s, 1, 100));
        retire("ACR123-2020", 1, 100, 0);
    }

    function test_OverlappingRangesRevert() public {
        retire("S", 101, 200, 0);
        bytes32 s = reg.seriesKey("acr", "S");
        // inside, straddling the start, straddling the end, covering it, one serial
        uint256[2][5] memory cases = [[uint256(150), 160], [uint256(50), 101], [uint256(200), 250], [uint256(1), 999], [uint256(200), 200]];
        for (uint256 i = 0; i < cases.length; i++) {
            uint256 hint = cases[i][0] > 101 ? 101 : 0;
            vm.expectRevert(abi.encodeWithSelector(RetirementRegistry.AlreadyRetired.selector, s, 101, 200));
            retire("S", cases[i][0], cases[i][1], hint);
        }
    }

    function test_DifferentUnitsSucceed() public {
        retire("S", 101, 200, 0);
        retire("S", 1, 100, 0); // before, adjacent
        retire("S", 301, 400, 101); // after, with a gap
        retire("S", 201, 300, 101); // fills the gap
        retire("T", 101, 200, 0); // same serials, another series
        reg.retire("verra", "S", 101, 200, 0, CLAIM, EVIDENCE); // same series id, another registry
        require(reg.nextOf(reg.seriesKey("acr", "S"), 0) == 1, "head");
        require(reg.nextOf(reg.seriesKey("acr", "S"), 201) == 301, "linked");
    }

    function test_WrongHintRevertsAndCannotHideOverlap() public {
        retire("S", 1, 10, 0);
        retire("S", 21, 30, 1);
        vm.expectRevert(abi.encodeWithSelector(RetirementRegistry.BadHint.selector, 0));
        retire("S", 41, 50, 0); // the true predecessor is 21
        vm.expectRevert(abi.encodeWithSelector(RetirementRegistry.BadHint.selector, 5));
        retire("S", 41, 50, 5); // not a range start
        vm.expectRevert(abi.encodeWithSelector(RetirementRegistry.BadHint.selector, 21));
        retire("S", 11, 20, 21); // hint above the new range
    }

    function test_EmptyRangeReverts() public {
        vm.expectRevert(abi.encodeWithSelector(RetirementRegistry.EmptyRange.selector, 0, 5));
        retire("S", 0, 5, 0);
        vm.expectRevert(abi.encodeWithSelector(RetirementRegistry.EmptyRange.selector, 9, 5));
        retire("S", 9, 5, 0);
    }

    function test_AnchorEmits() public {
        vm.warp(1_790_000_123);
        vm.recordLogs();
        bytes32 digest = sha256("signed record");
        reg.anchor(digest);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        require(logs.length == 1 && logs[0].topics[0] == RetirementRegistry.Anchored.selector, "anchored");
        require(logs[0].topics[1] == digest, "digest topic");
        (address sender, uint256 time) = abi.decode(logs[0].data, (address, uint256));
        require(sender == address(this) && time == 1_790_000_123, "anchor data");
    }
}
