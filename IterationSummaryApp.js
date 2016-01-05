(function() {
    var Ext = window.Ext4 || window.Ext;

    /**
     * Iteration Summary App
     */
    Ext.define('Rally.apps.iterationsummary.IterationSummaryApp', {
        extend: 'Rally.app.TimeboxScopedApp',
        requires: [
            'Ext.XTemplate',
            'Rally.util.DateTime',
            'Rally.data.ModelFactory',
            'Rally.nav.Manager',
            'Rally.data.wsapi.Store',
            'Rally.util.Timebox',
            'Deft.Deferred'
        ],
        appName: 'Iteration Summary',
        cls: 'iteration-summary-app',
        scopeType: 'iteration',
        mixins: [
            'Rally.clientmetrics.ClientMetricsRecordable'
        ],
        clientMetrics: [
            {
                method: '_onEditLinkClick',
                description: 'iteration summary app - edit iteration link'
            }
        ],

        statics: {
            PAST_WITH_SOME_UNACCEPTED_WORK: "Essayer d'accepter toutes les US/DE avant la fin de l\'itération !",
            PAST_WITH_ACCEPTED_WORK_AFTER_END_DATE: "Des éléments ont été acceptés après la fin de l\'itération.",
            CURRENT_WITH_SOME_UNACCEPTED_WORK: "Pensez à accepter bien avant la fin de l\'itération.",
            CURRENT_WITH_NO_ACCEPTED_WORK: "Penser à accepter vos premières stories aujourd\'hui !",
            PAST_WITH_DEFECTS: "Des defects associés n\'ont pas été fermées avant la fin de l\'itération.",
            CURRENT_WITH_DEFECTS: "Aucun defect associé à une US doit être ouvert pour qu'une US soit \"done\".",
            CURRENT_TESTS_FAILING_TITLE: "{PERCENT}% Tests OK",
            CURRENT_TESTS_FAILING_MESSAGE: "Tous les tests doivent être exécutés avant la fin de l\itération.",
            CURRENT_TESTS_PASSING: "Tous les tests sont OK.",
            WORK_NOT_ESTIMATED: "Des éléments n\'ont pas été estimés.",
            DEFINED_STATE: "Defined"
        },

        supportsUnscheduled: false,

        initComponent: function() {
            this.callParent(arguments);
            this.subscribe(this, Rally.Message.objectDestroy, this._refreshApp, this);
            this.subscribe(this, Rally.Message.objectCreate, this._refreshApp, this);
            this.subscribe(this, Rally.Message.objectUpdate, this._refreshApp, this);
            this.subscribe(this, Rally.Message.bulkUpdate, this._onBulkUpdate, this);
        },

        _shouldUpdate: function(record) {
            return this.getContext().getTimeboxScope().getRecord() &&
                Ext.Array.contains(['defect', 'hierarchicalrequirement', 'testset', 'defectsuite', 'testcase'], record.get('_type').toLowerCase());
        },

        _onBulkUpdate: function(records) {
            if(_.any(records, this._shouldUpdate, this)) {
                this._addContent();
            }
        },

        _refreshApp: function(record) {
            if(this._shouldUpdate(record)) {
                this._addContent();
            }
        },

        onScopeChange: function(scope) {
            delete this._tzOffset;
            this._addContent();
        },

        onNoAvailableTimeboxes: function() {
            this._checkAndDestroy('#dataContainer');
        },

        _isHsOrTeamEdition: function() {
            return Rally.environment.getContext().getSubscription().isAnyOfTheseTypes(['HS', 'Express_Edition']);
        },

        getIteration: function() {
            return this.getContext().getTimeboxScope().getRecord();
        },

        getStartDate: function() {
            return this.getIteration().get('StartDate');
        },

        getEndDate: function() {
            return this.getIteration().get('EndDate');
        },

        calculateTimeboxInfo: function() {
            var deferred = Ext.create('Deft.Deferred');

            if (!Ext.isDefined(this._tzOffset)) {
                this.recordLoadBegin({description: 'calcul boite de temps'});
                Rally.environment.getIoProvider().httpGet({
                    requester: this,
                    url: Rally.environment.getServer().getWsapiUrl() + '/iteration?includeSchema=true&pagesize=1&fetch=Name',
                    success: function(results) {
                        if (results.Schema.properties.EndDate.format.tzOffset !== undefined) {
                            this._tzOffset = results.Schema.properties.EndDate.format.tzOffset / 60;
                        } else {
                            this._tzOffset = 0;
                        }
                        this.timeBoxInfo = this._determineTimeBoxInfo(this._tzOffset);
                        this.recordLoadEnd();
                        deferred.resolve();
                    },
                    scope: this
                });
            } else {
                deferred.resolve(this._tzOffset);
            }
            return deferred.promise;
        },

        getScheduleStates: function() {
            var deferred = Ext.create('Deft.Deferred');

            this.recordLoadBegin({description: 'recuperation etats stories'});
            if (!Ext.isDefined(this._scheduleStates)) {
                Rally.data.ModelFactory.getModel({
                    type: 'UserStory',
                    context: this.getContext().getDataContext(),
                    success: function(model) {
                        this._scheduleStates = model.getField('ScheduleState').getAllowedStringValues();
                        deferred.resolve(this._scheduleStates);
                    },
                    scope: this
                });
            } else {
                deferred.resolve(this._scheduleStates);
            }
            return deferred.promise.always(function(obj) {
                this.recordLoadEnd();
                return obj;
            }, this);
        },

        _addContent: function(scope) {
            var iteration = this.getIteration();

            return this.calculateTimeboxInfo().then({
                success: function() {
                    this._checkAndDestroy('#dataContainer');

                    this.add({
                        xtype: 'container',
                        itemId: 'dataContainer',
                        cls: 'message',
                        defaults: {
                            xtype: 'component'
                        },
                        items: [
                            {
                                cls: 'dates',
                                html: Rally.util.DateTime.formatWithDefault(this.getStartDate(), this.getContext()) + ' - ' +
                                        Rally.util.DateTime.formatWithDefault(this.getEndDate(), this.getContext()) + '   (' + this._buildDaysRemainingMessage() + ')'
                            },
							{
                                html: '</br>'//this._buildDaysRemainingMessage()
                            },
                            {
                                xtype: 'container',
                                itemId: 'stats'
                            }
							/*,
                            {
                                xtype: 'component',
                                cls: 'edit',
                                renderTpl: new Ext.XTemplate('<a class="editLink" href="#">Edit iteration...</a>'),
                                renderSelectors: { editLink: '.editLink' },
                                listeners: {
                                    editLink: {
                                        click: this._onEditLinkClick,
                                        stopEvent: true,
                                        scope: this
                                    }
                                }
                            }*/
                        ]
                    });

                    this._getStatusRowData();
                },
                scope: this
            });
        },

        _onEditLinkClick: function() {
            Rally.nav.Manager.edit(this.getIteration().get('_ref'));
        },

        _buildDaysRemainingMessage: function() {
            var message = '';

            if (this.timeBoxInfo.daysRemaining > 0) {
                var remainingText = this.timeBoxInfo.daysRemaining === 1 ? ' Jour restant' : ' Jours restants ';
                message = '<span class="daysRemaining">' + this.timeBoxInfo.daysRemaining + remainingText + '</span> sur l\'itération de ';
            }

            message += this.timeBoxInfo.timeboxLength + ' Jours';
            return message;
        },

        _determineTimeBoxInfo: function(tzOffset) {
            var timeboxCounts = Rally.util.Timebox.getCounts(this.getStartDate(), this.getEndDate(),
                                this.getContext().getWorkspace().WorkspaceConfiguration.WorkDays, tzOffset);

            return {
                timeOrientation: Rally.util.Timebox.getOrientation(this.getStartDate(), this.getEndDate(), tzOffset),
                timeboxLength: timeboxCounts.workdays,
                daysRemaining: timeboxCounts.remaining
            };
        },

        _checkAndDestroy: function(itemId) {
            if (this.down(itemId)) {
                this.down(itemId).destroy();
            }
        },

        _getStatusRowData: function() {
            var queryObjects = {
                hierarchicalrequirement: 'Defects:summary[State],TestCases:summary[LastVerdict],PlanEstimate,AcceptedDate,ScheduleState',
                defect: 'TestCases:summary[LastVerdict],PlanEstimate,AcceptedDate,ScheduleState'
            };
            this.results = {};

            this.recordLoadBegin({description: 'getting status row data'});

            if (!this._isHsOrTeamEdition()) {
                Ext.apply(queryObjects, {
                    defectsuite: 'Defects:summary[State],PlanEstimate,AcceptedDate,ScheduleState',
                    testset: 'TestCases:summary[LastVerdict],PlanEstimate,AcceptedDate,ScheduleState'
                });
            }

            Rally.data.ModelFactory.getModels({
                types: Ext.Object.getKeys(queryObjects),
                success: function(models) {
                    var loadPromises = [];

                    Ext.Object.each(queryObjects, function(key, value) {
                        if (models[key]) {
						
							//**************TODO essayer de recuperer le loadDeferred pour optimiser
							//et d'utiliser queryObjects !!!
							
                            var loadDeferred = Ext.create('Deft.Deferred');
                            Ext.create('Rally.data.wsapi.Store', {
                                model: models[key],
                                fetch: value,
                                context: this.getContext().getDataContext(),
                                filters: [this.getContext().getTimeboxScope().getQueryFilter()],
                                limit: Infinity,
                                autoLoad: true,
                                requester: this,
                                listeners: {
                                    load: function(store, data) {
                                        this.results[store.model.prettyTypeName] = data;
                                        loadDeferred.resolve();
                                    },
                                    scope: this
                                }
                            });
                            loadPromises.push(loadDeferred.promise);
                        }
                    }, this);

                    if (loadPromises.length === 0) {
                        this.recordLoadEnd();
                        this.recordComponentReady();
                    } else {
                        Deft.Promise.all(loadPromises).then({
                            success: function() {
                                this.recordLoadEnd();
                                this._displayStatusRows();
                            },
                            scope: this
                        });
                    }
                },
                scope: this
            });
        },

        _getPostAcceptedState: function() {
            return this.getScheduleStates().then({
                success: function(states) {
                    if (states.length <= 4) {
                        return null;
                    } else if (states.length === 5) {
                        return states[0] === this.self.DEFINED_STATE ? states[4] : null;
                    }
                    return states[5];
                },
                scope: this
            });
        },

        //only show statuses if we are 1/2 through the timebox or 5 days into a timebox
        _showStatuses: function() {
            return ((this.timeBoxInfo.timeboxLength - this.timeBoxInfo.daysRemaining) >= 5 || (this.timeBoxInfo.timeboxLength - this.timeBoxInfo.daysRemaining) > this.timeBoxInfo.daysRemaining);
        },

        _aggregateAcceptance: function(items, postAcceptedState) {
            var acceptanceData = {
                totalPlanEstimate: 0,
                totalAcceptedPoints: 0,
                totalItems: 0,
				totalUS: 0,
				totalDefects: 0,
				totalTestSets:0,
                totalAcceptedItems: 0,
                acceptedLate: false,
                workNotEstimated: 0};

            Ext.each(items, function(item) {
                acceptanceData.totalItems++;
				if(item.get('_type') === "defect" ){
					acceptanceData.totalDefects++;
				} else if (item.get('_type') === "testset" ) {
					acceptanceData.totalTestSets++;
				} else {
					acceptanceData.totalUS++;
				}
				console.log(item.get('_type'));
                if (item.get('PlanEstimate')) {
                    acceptanceData.totalPlanEstimate += item.get('PlanEstimate');
                }
                if (item.get('ScheduleState') === "Accepted" ||
                        (postAcceptedState !== null && item.get('ScheduleState') === postAcceptedState)) {
                    acceptanceData.totalAcceptedPoints += item.get('PlanEstimate');
                    acceptanceData.totalAcceptedItems++;

                    if (item.get('AcceptedDate') && item.get('AcceptedDate') > this.getEndDate()) {
                        acceptanceData.acceptedLate = true;
                    }
                } else if (!item.get('PlanEstimate')) {
                    acceptanceData.workNotEstimated++;
                }
            }, this);

            return acceptanceData;
        },

        _getAcceptanceConfigObject: function() {
            return this._getPostAcceptedState().then({
                success: function(postAcceptedState) {
                    var totalPlanEstimate = 0;
                    var totalAcceptedPoints = 0;
                    var totalItems = 0;
					var totalUS = 0;
					var totalDefects= 0;
					var totalTestSets=0;
                    var totalAcceptedItems = 0;
                    var acceptedLate = false;
                    var workNotEstimated = 0;

                    Ext.Object.each(this.results, function(key, item) {
                        var itemAcceptanceData = this._aggregateAcceptance(item, postAcceptedState);
                        totalPlanEstimate += itemAcceptanceData.totalPlanEstimate;
                        totalAcceptedPoints += itemAcceptanceData.totalAcceptedPoints;
                        totalItems += itemAcceptanceData.totalItems;
						totalUS += itemAcceptanceData.totalUS;
						totalDefects += itemAcceptanceData.totalDefects;
						totalTestSets += itemAcceptanceData.totalTestSets;
                        totalAcceptedItems += itemAcceptanceData.totalAcceptedItems;
                        if (!acceptedLate) {
                            acceptedLate = itemAcceptanceData.acceptedLate;
                        }
                        workNotEstimated += itemAcceptanceData.workNotEstimated;
                    }, this);


					
					//TODO refactor in one method to avoid duplicate !!!
					
                    var config = { rowType: 'pointAcceptance'};
					//Calculate the acceptance percentage.
                    // ||1 - Handle NaN resulting from divide by 0
                    var percentAccepted = Math.floor((totalAcceptedPoints / (totalPlanEstimate || 1)) * 100);

                    if (this.timeBoxInfo.timeOrientation !== "future") {

                        // days remaining   : percent accepted      : status
                        // ----------------------------------------------
                        // 0                : 100                   : success
                        // 0                : <100                  : error
                        // beyond half      : 0                     : warn
                        // beyond half      : >0                    : pending

                        config.title = percentAccepted + "% Acceptés en points";
                        config.subtitle = "(" + Ext.util.Format.round(totalAcceptedPoints, 2) + " sur " + Ext.util.Format.round(totalPlanEstimate, 2) + " " +
                                this.getContext().getWorkspace().WorkspaceConfiguration.IterationEstimateUnitName + ")";
                        config.message = "";
                        if (this.timeBoxInfo.daysRemaining === 0) {
                            if (percentAccepted < 100) {
                                config.status = "error";
                                config.message = this.self.PAST_WITH_SOME_UNACCEPTED_WORK;
                            } else if (acceptedLate) {
                                config.message = this.self.PAST_WITH_ACCEPTED_WORK_AFTER_END_DATE;
                                config.status = "success";
                            } else {
                                config.status = "success";
                            }
                        } else if (this._showStatuses()) {
                            if (percentAccepted === 0) {
                                config.status = "warn";
                            } else if (percentAccepted === 100) {
                                if (workNotEstimated === 0) {
                                    config.status = "success";
                                } else {
                                    config.status = "pending";
                                    config.message = workNotEstimated + this.self.WORK_NOT_ESTIMATED;
                                }
                            } else {
                                config.status = "pending";
                            }
                            if (percentAccepted < 100) {
                                config.message = this.self.CURRENT_WITH_SOME_UNACCEPTED_WORK;
                            }
                        } else {
                            config.status = "pending";
                            if (percentAccepted === 0) {
                                config.message = this.self.CURRENT_WITH_NO_ACCEPTED_WORK;
                            }
                        }
                    }
					
					var list = {
						tous : totalUS,
						tode : totalDefects,
						acus : totalAcceptedItems,
						tosp : totalPlanEstimate,
						acsp : totalAcceptedPoints,
						plvc : this.getIteration().get("PlannedVelocity")
					};
					config.list = [];
					config.list.push(list);
					
					
					var configNb = { rowType: 'nbAcceptance'};
					var percentAcceptedNb = Math.floor((totalAcceptedItems / (totalItems || 1)) * 100);

                    if (this.timeBoxInfo.timeOrientation !== "future") {

                        // days remaining   : percent accepted      : status
                        // ----------------------------------------------
                        // 0                : 100                   : success
                        // 0                : <100                  : error
                        // beyond half      : 0                     : warn
                        // beyond half      : >0                    : pending

                        configNb.title = percentAcceptedNb + "% Acceptés en nombre";
                        configNb.subtitle = "(" + Ext.util.Format.round(totalAcceptedItems, 2) + " sur " + Ext.util.Format.round(totalItems, 2) + ")";
                        configNb.message = "";
                        if (this.timeBoxInfo.daysRemaining === 0) {
                            if (percentAccepted < 100) {
                                configNb.status = "error";
                                configNb.message = this.self.PAST_WITH_SOME_UNACCEPTED_WORK;
                            } else if (acceptedLate) {
                                configNb.message = this.self.PAST_WITH_ACCEPTED_WORK_AFTER_END_DATE;
                                configNb.status = "success";
                            } else {
                                configNb.status = "success";
                            }
                        } else if (this._showStatuses()) {
                            if (percentAccepted === 0) {
                                configNb.status = "warn";
                            } else if (percentAccepted === 100) {
                                if (workNotEstimated === 0) {
                                    configNb.status = "success";
                                } else {
                                    configNb.status = "pending";
                                    configNb.message = workNotEstimated + this.self.WORK_NOT_ESTIMATED;
                                }
                            } else {
                                configNb.status = "pending";
                            }
                            if (percentAccepted < 100) {
                                configNb.message = this.self.CURRENT_WITH_SOME_UNACCEPTED_WORK;
                            }
                        } else {
                            configNb.status = "pending";
                            if (percentAccepted === 0) {
                                configNb.message = this.self.CURRENT_WITH_NO_ACCEPTED_WORK;
                            }
                        }
                    }

                    return [config,configNb];
                },
                scope: this
            });
        },

        _getActiveDefectCount: function(items) {
			var nbDefects = 0;
            var activeDefectsCount = 0;
            items = items || [];
            Ext.Array.forEach(items, function(item) {
                var defectSummary = item.get('Summary').Defects;
                Ext.Object.each(defectSummary.State, function(state, count) {
                    if (state !== 'Closed') {
                        activeDefectsCount += count;
                    }
					nbDefects++;
                });
            });
            return [nbDefects, activeDefectsCount];
        },

        _getDefectsConfigObject: function() {
			console.log(this._getActiveDefectCount(this.results.userstory));
            var totalDefectCount = this._getActiveDefectCount(this.results.userstory)[0];

            if (this.results.defectsuite) {
                totalDefectCount += this._getActiveDefectCount(this.results.defectsuite)[0];
            }

            var config = { rowType: 'defects'};

            if (totalDefectCount > 0 && this.timeBoxInfo.timeOrientation !== "future") {
                config.title = totalDefectCount + " Defect associé" + (totalDefectCount !== 1 ? "s" : "");
                config.subtitle = "";

                if (this.timeBoxInfo.timeOrientation === "past") {
                    config.status = "error";
                    config.message = this.self.PAST_WITH_DEFECTS;
                } else if (this.timeBoxInfo.timeOrientation === "current") {
                    config.status = "warn";
                    config.message = this.self.CURRENT_WITH_DEFECTS;
                }
            }
            return config;
        },

        _getPassingTestCases: function(items) {
            var testCounts = {passingTests: 0, totalTests: 0};
            items = items || [];

            Ext.Array.forEach(items, function(item) {
                var testCaseSummary = item.get('Summary').TestCases;
                Ext.Object.each(testCaseSummary.LastVerdict, function(verdict, count) {
                    if (verdict === 'Pass') {
                        testCounts.passingTests += count;
                    }
                    testCounts.totalTests += count;
                });
            });
            return testCounts;
        },

        _getTestsConfigObject: function() {
            var config = { rowType: 'testsPassing' };
            var testCounts = {passingTests: 0, totalTests: 0};
            var testTypes = ["userstory", "defect", "testset"];

            Ext.Array.forEach(testTypes, function(testType) {
                var tmpTestCnt = this._getPassingTestCases(this.results[testType]);
                testCounts.totalTests += tmpTestCnt.totalTests;
                testCounts.passingTests += tmpTestCnt.passingTests;
            }, this);

            if (testCounts.totalTests !== 0 && this.timeBoxInfo.timeOrientation !== "future") {

                // days remaining   : number passing        : status
                // -------------------------------------------------
                // *                : all                   : success
                // in the past      : <all                  : error
                // beyond half      : 0                     : warning
                // beyond half      : >0                    : pending

                var percentPassing = Math.floor((testCounts.passingTests / testCounts.totalTests) * 100);

                config.title = this.self.CURRENT_TESTS_FAILING_TITLE.replace("{PERCENT}", percentPassing);
                config.subtitle = "(" + testCounts.passingTests + " sur " + testCounts.totalTests + ")";

                if (testCounts.passingTests === testCounts.totalTests) {
                    config.message = this.self.CURRENT_TESTS_PASSING;
                    config.status = "success";
                } else {
                    config.message = this.self.CURRENT_TESTS_FAILING_MESSAGE;
                    if (this.timeBoxInfo.timeOrientation === "past") {
                        config.status = "error";
                    } else if (this._showStatuses()) {
                        config.status = testCounts.passingTests === 0 ? 'warn' : 'pending';
                    } else {
                        config.status = "pending";
                    }
                }
            }
            return config;
        },

        _displayStatusRows: function() {
            return this._getAcceptanceConfigObject().then({
                success: function(acceptanceConfigObject) {
                    this.down('#stats').suspendLayouts();
                    this.down('#stats').removeAll();
                    this._displayStatusRow(acceptanceConfigObject[0]);
					this._displayStatusRow(acceptanceConfigObject[1]);
                    this._displayStatusRow(this._getDefectsConfigObject());
                    if (!this._isHsOrTeamEdition()) {
                        this._displayStatusRow(this._getTestsConfigObject());
                    }
                    this.down('#stats').resumeLayouts(true);
                    this.recordComponentReady();
                },
                scope: this
            });
        },

        _displayStatusRow: function(rowConfig) {
            if (rowConfig.title) {
                var items = [
                    {
                        cls: 'header ' + rowConfig.rowType || '',
                        html: rowConfig.title + '<span class="subtitle">' + rowConfig.subtitle + '</span>'
                    }
                ];

                if (rowConfig.message) {
                    var message = rowConfig.message;
                    items.push({
                        cls: 'details',
                        html: message
                    });
                }
				
				// to add this item only once
				if ( rowConfig.rowType === "pointAcceptance" ){
												
					var gridStore = Ext.create('Rally.data.custom.Store', {
						data: rowConfig.list,
						limit:Infinity
						//groupField: 'projectname'
					});
					
					this.down('#stats').add({
						xtype: 'rallygrid',
						store: gridStore,
						itemId: 'storyGrid',
						showRowActionsColumn: false,
						showPagingToolbar : false,
						columnCfgs:[
							{
							text: 'NB US', dataIndex: 'tous'
							},
							{
							text: 'NB defects', dataIndex: 'tode'
							},
							{
							text: 'NB US/DE Acceptés', dataIndex: 'acus'
							},
							{
							text: 'Nb points planifiés', dataIndex: 'tosp'
							},
							{
							text: 'Nb points prévus (vélocité)', dataIndex: 'plvc'
							},
							{
							text: 'Nb points acceptés', dataIndex: 'acsp'
							}
						]
					});
				
				}

                this.down('#stats').add({
                    xtype: 'container',
                    cls: rowConfig.status ? 'timeboxStatusRow ' + rowConfig.status : 'timeboxStatusRow',
                    items: [
                        {
                            xtype: 'container',
                            cls: 'timeboxStatusDetails',
                            defaults: { xtype: 'component' },
                            items: items
                        }
                    ]
                });
            }
        }
    });
})();