// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

library CertificateNFTv1MetaData {
    struct MetaData {
        uint16 schemaVersion;
        uint16 achievementType;
        uint64 awardedDate;
        uint64 validFrom;
        uint64 validUtil;
        string issuerDid;
        string achievementId;
    }
}
