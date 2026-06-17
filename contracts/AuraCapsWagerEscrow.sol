// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IVibeRarityProvider {
    struct RarityInfo {
        uint8 rarity;
        uint256 randomValue;
        bytes32 tokenSpecificRandomness;
    }

    function getTokenRarity(uint256 tokenId) external view returns (RarityInfo memory);
}

contract AuraCapsWagerEscrow is AccessControl, ERC721Holder, Pausable, ReentrancyGuard {
    bytes32 public constant RESULT_SIGNER_ROLE = keccak256("RESULT_SIGNER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    enum Status {
        None,
        Created,
        Funded,
        Settled,
        Refunded
    }

    struct MatchEscrow {
        address collection;
        address playerA;
        address playerB;
        uint256 tokenA;
        uint256 tokenB;
        uint8 rarity;
        uint64 refundAfter;
        Status status;
    }

    mapping(bytes32 matchId => MatchEscrow escrow) public escrows;

    event MatchCreated(
        bytes32 indexed matchId,
        address indexed collection,
        address indexed playerA,
        uint256 tokenA,
        uint8 rarity,
        uint64 refundAfter
    );
    event MatchJoined(bytes32 indexed matchId, address indexed playerB, uint256 tokenB);
    event MatchSettled(bytes32 indexed matchId, address indexed winner, uint256 tokenA, uint256 tokenB);
    event MatchDrawSettled(bytes32 indexed matchId, uint256 tokenA, uint256 tokenB);
    event MatchRefunded(bytes32 indexed matchId);

    error InvalidMatch();
    error InvalidPlayer();
    error InvalidToken();
    error InvalidRarity();
    error InvalidStatus();
    error RefundLocked();

    constructor(address admin, address resultSigner) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(RESULT_SIGNER_ROLE, resultSigner);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function createMatch(
        bytes32 matchId,
        address collection,
        uint256 tokenId,
        uint64 refundAfter
    ) external nonReentrant whenNotPaused {
        if (matchId == bytes32(0) || collection == address(0)) revert InvalidMatch();
        if (escrows[matchId].status != Status.None) revert InvalidStatus();
        if (refundAfter <= block.timestamp) revert RefundLocked();

        uint8 rarity = _rarityOf(collection, tokenId);
        if (rarity == 0) revert InvalidRarity();

        IERC721(collection).safeTransferFrom(msg.sender, address(this), tokenId);

        escrows[matchId] = MatchEscrow({
            collection: collection,
            playerA: msg.sender,
            playerB: address(0),
            tokenA: tokenId,
            tokenB: 0,
            rarity: rarity,
            refundAfter: refundAfter,
            status: Status.Created
        });

        emit MatchCreated(matchId, collection, msg.sender, tokenId, rarity, refundAfter);
    }

    function joinMatch(bytes32 matchId, uint256 tokenId) external nonReentrant whenNotPaused {
        MatchEscrow storage escrow = escrows[matchId];
        if (escrow.status != Status.Created) revert InvalidStatus();
        if (msg.sender == escrow.playerA) revert InvalidPlayer();
        if (tokenId == escrow.tokenA) revert InvalidToken();
        if (_rarityOf(escrow.collection, tokenId) != escrow.rarity) revert InvalidRarity();

        IERC721(escrow.collection).safeTransferFrom(msg.sender, address(this), tokenId);

        escrow.playerB = msg.sender;
        escrow.tokenB = tokenId;
        escrow.status = Status.Funded;

        emit MatchJoined(matchId, msg.sender, tokenId);
    }

    function settle(bytes32 matchId, address winner) external nonReentrant onlyRole(RESULT_SIGNER_ROLE) {
        MatchEscrow storage escrow = escrows[matchId];
        if (escrow.status != Status.Funded) revert InvalidStatus();
        if (winner != escrow.playerA && winner != escrow.playerB) revert InvalidPlayer();

        escrow.status = Status.Settled;
        IERC721 collection = IERC721(escrow.collection);
        collection.safeTransferFrom(address(this), winner, escrow.tokenA);
        collection.safeTransferFrom(address(this), winner, escrow.tokenB);

        emit MatchSettled(matchId, winner, escrow.tokenA, escrow.tokenB);
    }

    function settleDraw(bytes32 matchId) external nonReentrant onlyRole(RESULT_SIGNER_ROLE) {
        MatchEscrow storage escrow = escrows[matchId];
        if (escrow.status != Status.Funded) revert InvalidStatus();

        escrow.status = Status.Settled;
        IERC721 collection = IERC721(escrow.collection);
        collection.safeTransferFrom(address(this), escrow.playerA, escrow.tokenA);
        collection.safeTransferFrom(address(this), escrow.playerB, escrow.tokenB);

        emit MatchDrawSettled(matchId, escrow.tokenA, escrow.tokenB);
    }

    function refund(bytes32 matchId) external nonReentrant {
        MatchEscrow storage escrow = escrows[matchId];
        if (escrow.status != Status.Created && escrow.status != Status.Funded) revert InvalidStatus();
        if (block.timestamp < escrow.refundAfter) revert RefundLocked();
        if (msg.sender != escrow.playerA && msg.sender != escrow.playerB) revert InvalidPlayer();

        Status previousStatus = escrow.status;
        escrow.status = Status.Refunded;
        IERC721 collection = IERC721(escrow.collection);
        collection.safeTransferFrom(address(this), escrow.playerA, escrow.tokenA);
        if (previousStatus == Status.Funded) {
            collection.safeTransferFrom(address(this), escrow.playerB, escrow.tokenB);
        }

        emit MatchRefunded(matchId);
    }

    function _rarityOf(address collection, uint256 tokenId) private view returns (uint8) {
        return IVibeRarityProvider(collection).getTokenRarity(tokenId).rarity;
    }
}
