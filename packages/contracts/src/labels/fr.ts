import type {
  AbcClass,
  AlertLevel,
  Permission,
  RequestStatus,
  Role,
  TransitionAction,
} from "@leoni/core";

/**
 * French vocabulary for every enumerated value in the domain.
 *
 * The interface is in French and the code is in English (brief section 6.2).
 * This file is the single seam between the two, and it exists so that a French
 * label never appears inline in a component. Two reasons that matters:
 *
 *  - "Rupture" must read identically on the alert board, in the CSV export and
 *    in the PDF report. Three inline strings drift; one map does not.
 *  - The wording is logistics vocabulary, not developer prose. Keeping it in one
 *    reviewable file lets the logistics team correct the terminology without
 *    touching a single component.
 *
 * `Record<Union, string>` is deliberate: adding a status to the domain without
 * translating it here fails the build.
 */

export const ROLE_LABELS_FR: Readonly<Record<Role, string>> = {
  ADMIN: "Administrateur",
  LTN1_STOREKEEPER: "Magasinier LTN1",
  LTN1_WAREHOUSE_MANAGER: "Responsable magasin LTN1",
  LTN4_RESPONSIBLE: "Responsable LTN4",
  LOGISTICS_MANAGER: "Responsable logistique",
};

export const ALERT_LEVEL_LABELS_FR: Readonly<Record<AlertLevel, string>> = {
  NORMAL: "Normal",
  WARNING: "Alerte",
  CRITICAL: "Critique",
  RUPTURE: "Rupture",
};

export const ABC_CLASS_LABELS_FR: Readonly<Record<AbcClass, string>> = {
  A: "Classe A — forte rotation",
  B: "Classe B — rotation moyenne",
  C: "Classe C — faible rotation",
};

export const REQUEST_STATUS_LABELS_FR: Readonly<Record<RequestStatus, string>> = {
  DRAFT: "Brouillon",
  PENDING_APPROVAL: "En attente de validation",
  APPROVED: "Validee",
  SENT_TO_LTN4: "Transmise a LTN4",
  IN_PREPARATION: "En preparation",
  PARTIALLY_AVAILABLE: "Partiellement disponible",
  LTN4_STOCK_OUT: "Rupture LTN4",
  READY: "Prete",
  SHIPPED: "Expediee",
  IN_TRANSIT: "En transit",
  RECEIVED: "Receptionnee",
  CLOSED: "Cloturee",
  REJECTED: "Refusee",
  CANCELLED: "Annulee",
};

/**
 * Verbs for the action buttons, keyed by the `action` identifier in the domain
 * transition table. The button on screen and the transition the server will
 * accept therefore always describe the same operation.
 */
/**
 * Keyed by the domain's `TransitionAction`, plus `create` for the history row
 * that records creation. Typed rather than `Record<string, string>` so that
 * adding a transition without wording its button fails to compile.
 */
export const REQUEST_ACTION_LABELS_FR: Readonly<Record<TransitionAction | "create", string>> = {
  create: "Creer",
  submit: "Soumettre a validation",
  approve: "Valider",
  reject: "Refuser",
  cancel: "Annuler",
  transmit: "Transmettre a LTN4",
  startPreparation: "Demarrer la preparation",
  prepareAvailable: "Preparer le disponible",
  resumePreparation: "Reprendre la preparation",
  declarePartial: "Declarer une disponibilite partielle",
  declareStockOut: "Declarer une rupture",
  markReady: "Marquer comme prete",
  ship: "Expedier",
  markInTransit: "Marquer en transit",
  confirmReceipt: "Confirmer la reception",
  close: "Cloturer",
};

export const MOVEMENT_TYPE_LABELS_FR = {
  ENTRY: "Entree",
  EXIT: "Sortie",
  ADJUSTMENT: "Ajustement",
  TRANSFER_IN: "Transfert entrant",
  TRANSFER_OUT: "Transfert sortant",
} as const satisfies Record<string, string>;

export const PRIORITY_LABELS_FR = {
  LOW: "Basse",
  NORMAL: "Normale",
  HIGH: "Haute",
  URGENT: "Urgente",
} as const satisfies Record<string, string>;

export const RECALCULATION_TRIGGER_LABELS_FR = {
  SCHEDULED: "Recalcul planifie",
  MANUAL: "Recalcul manuel",
  IMPORT: "Import de donnees",
  PARAMETER_CHANGE: "Modification des parametres",
} as const satisfies Record<string, string>;

/**
 * Permission labels, for the role-management screen. Written as sentences the
 * Administrator can reason about rather than as the `entity:verb` identifiers
 * used in code.
 */
export const PERMISSION_LABELS_FR: Readonly<Record<Permission, string>> = {
  "article:read": "Consulter les articles",
  "article:write": "Modifier les articles",
  "article:import": "Importer le fichier articles",
  "stock:read": "Consulter les stocks",
  "stock:move": "Enregistrer un mouvement de stock",
  "stock:adjust": "Ajuster un stock",
  "alert:read": "Consulter le tableau des alertes",
  "request:read": "Consulter les demandes",
  "request:create": "Creer une demande",
  "request:approve": "Valider une demande",
  "request:transmit": "Transmettre une demande a LTN4",
  "request:prepare": "Preparer une demande",
  "request:ship": "Expedier une demande",
  "request:receive": "Receptionner une demande",
  "request:close": "Cloturer une demande",
  "request:cancel": "Annuler une demande",
  "request:comment": "Commenter une demande",
  "parameter:read": "Consulter les parametres de reapprovisionnement",
  "parameter:write": "Modifier les parametres de reapprovisionnement",
  "threshold:recalculate": "Recalculer les seuils",
  "dashboard:read": "Consulter les tableaux de bord",
  "report:export": "Exporter les rapports",
  "user:read": "Consulter les utilisateurs",
  "user:write": "Gerer les utilisateurs",
  "audit:read": "Consulter le journal d audit",
};

/** Domain vocabulary reused across screens, kept consistent with the report. */
export const GLOSSARY_FR = {
  replenishment: "Reapprovisionnement",
  minThreshold: "Seuil mini",
  maxThreshold: "Seuil maxi",
  safetyStock: "Stock de securite",
  coverage: "Couverture",
  coverageDays: "Couverture (jours)",
  vpe: "VPE (unites par boite)",
  fifo: "FIFO",
  leadTime: "Delai de livraison",
  averageConsumption: "Consommation moyenne / jour",
  currentStock: "Stock actuel",
  recommendedQuantity: "Quantite preconisee",
  boxCount: "Nombre de boites",
  need: "Besoin",
  stockOut: "Rupture",
  serviceLevel: "Taux de service",
  abcClass: "Classe ABC",
} as const;
