"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishScheduled = exports.syncIgInsights = exports.syncFbInsights = void 0;
const admin = require("firebase-admin");
admin.initializeApp();
var syncFbInsights_1 = require("./syncFbInsights");
Object.defineProperty(exports, "syncFbInsights", { enumerable: true, get: function () { return syncFbInsights_1.syncFbInsights; } });
var syncIgInsights_1 = require("./syncIgInsights");
Object.defineProperty(exports, "syncIgInsights", { enumerable: true, get: function () { return syncIgInsights_1.syncIgInsights; } });
var publishScheduled_1 = require("./publishScheduled");
Object.defineProperty(exports, "publishScheduled", { enumerable: true, get: function () { return publishScheduled_1.publishScheduled; } });
//# sourceMappingURL=index.js.map