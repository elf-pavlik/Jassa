(function($) {

	
	var service = Jassa.service;
	var rdf = Jassa.rdf;
	
	var ns = Jassa.facete;
	
	
	
	ns.FacetTreeServiceImpl = Class.create({
		initialize: function(facetService, expansionSet, facetStateProvider) { //facetStateProvider) {
			this.facetService = facetService;
			this.expansionSet = expansionSet;
			this.facetStateProvider = facetStateProvider;
		},
		
		fetchFacetTree: function() {
			var path = new ns.Path.parse();
			
			var result = this.fetchFacetTreeRec(path);
			
			result.done(function(facetTree) { console.log("FacetTree: ", facetTree); });
			
			return result;
		},
		
		fetchFacetTreeRec: function(path) {
			
			var self = this;
			
			
			var result = $.Deferred();
			
            var limit = null;
            var offset = null;

            var state = this.facetStateProvider.getFacetState(path);
			
            if(state) {
                var resultRange = state.getResultRange();
                
                limit = resultRange.getLimit();
                offset = resultRange.getOffset();
            }
			
            var countPromise = this.facetService.fetchFacetCount(path, false);
			
			var childFacetsPromise = this.facetService.fetchFacets(path, false, limit, offset);
//            promise.done(function(facetItems) {
			
			var promises = [countPromise, childFacetsPromise];
			
            $.when.apply(window, promises).done(function(childFacetCount, facetItems) {
			
				var data = [];
				
				var childPromises = [];
				
				var i = 0;
				_(facetItems).each(function(facetItem) {
					
					//debugger;
					var path = facetItem.getPath();

										
					var uri = facetItem.getNode().getUri();
					
					var isExpanded = self.expansionSet.contains(path);
					//var childPath = path.copyAppendStep(new facete.Step(uri, false));

					// Check if the node corresponding to the path is expanded so
					// that we need to fetch the child facets
					//var facetState = this.facetStateProvider.getFacetState(path);

//					console.log("facetState:", childFacetState);
//					console.log("childPath:" + childPath);
					//console.log("childPath:" + facetItem.getPath());

					
					var dataItem = {
						item: facetItem,
						isExpanded: isExpanded,
						//state: facetState,
						children: null,
						childFacetCount: childFacetCount,
						limit: limit,
						offset: offset
					};
					++i;

					data.push(dataItem);
					
					// TODO: Fetch the distinct value count for the path
					if(!isExpanded) {
						return;
					}
//					if(!(facetState && facetState.isExpanded())) {
//						return;
//					}
					console.log("Got a child facet for path " + path);
					
					var childPromise = self.fetchFacetTreeRec(path).pipe(function(childItems) {
						dataItem.children = childItems;
					});

					childPromises.push(childPromise);
				});

				
				$.when.apply(window, childPromises)
					.done(function() {

//						var data = [];
//						_(arguments).each(function(arg) {
//							console.log('got arg', arg);
//						});
//						
//						var item = {
//							path: path,
//							distinctValueCount: 
//						};
						
						result.resolve(data);
					}).
					fail(function() {
						result.fail();
					});
				
			});
			
			return result.promise();
		}
	});
	
	
	ns.FacetService = Class.create({
		fetchFacets: function(path, isInverse) {
			throw "Override me";
		}
	});
	
	
	ns.FacetItem = Class.create({
		initialize: function(path, node, distinctValueCount) {
			this.path = path;
			this.node = node;
			this.distinctValueCount = distinctValueCount;
		},

//		getUri: functino() {
//			return node.getUri 
//		},
		getNode: function() {
			return this.node;
		},
		
		getPath: function() {
			return this.path;
		},
		
		getDistinctValueCount: function() {
			return this.distinctValueCount;
		}
	});
	

	ns.FacetServiceImpl = Class.create(ns.FacetService, {
		initialize: function(queryExecutionFactory, facetConceptGenerator) {
			this.qef = queryExecutionFactory;
			this.facetConceptGenerator = facetConceptGenerator;
		},

		
		createConceptFacetValues: function(path, excludeSelfConstraints) {
			var concept = this.facetConceptGenerator.createConceptResources(path, excludeSelfConstraints);
			return concept;
		},
		
	
		fetchFacetCount: function(path, isInverse) {
            var concept = this.facetConceptGenerator.createConceptFacets(path, isInverse);
            
            //var groupVar = facetConcept.getFacetVar();
            var outputVar = rdf.NodeFactory.createVar('_c_');
//            var countVar = concept.getVar();
//            var elements = concept.getElements();
        
            //var query = ns.QueryUtils.createQueryCount(elements, null, countVar, outputVar, null, true); 

            var query = ns.ConceptUtils.createQueryCount(concept, outputVar);

            var qe = this.qef.createQueryExecution(query);
            
            var promise = service.ServiceUtils.fetchInt(qe, outputVar);

            return promise;
		},
		
		
		fetchFacets: function(path, isInverse, limit, offset) {
		    
//		    this.fetchFacetCount(path, isInverse).done(function(cnt) {
//		        console.log('Number of facets at ' + path + ': ' + cnt); 
//		    });
		    
			var concept = this.facetConceptGenerator.createConceptFacets(path, isInverse);
			
			var query = ns.ConceptUtils.createQueryList(concept);
			//alert("" + query);
			query.setLimit(limit);
			query.setOffset(offset);
			
			//var query = this.facetQueryGenerator.createQueryFacets();
			
			var qe = this.qef.createQueryExecution(query);
			
			var promise = service.ServiceUtils.fetchList(qe, concept.getVar());

			
			var self = this;
			
			var deferred = $.Deferred();

			promise.done(function(properties) {
				var promise = self.fetchFacetValueCounts(path, isInverse, properties, false);
				
				promise.done(function(r) {
					deferred.resolve(r);
				}).fail(function() {
					deferred.fail();
				});

			}).fail(function() {
				deferred.fail();
			});
			
			
			return deferred.promise();
		},
		
		
		//elements, limit, variable, outputVar, groupVars, useDistinct, options
		/**
		 * Returns the distinctValueCount for a set of properties at a given path
		 * 
		 */
		fetchFacetValueCounts: function(path, isInverse, properties, isNegated) {
			var facetConceptItems = this.facetConceptGenerator.createConceptFacetValues(path, isInverse, properties, isNegated);
			
			
			var outputVar = rdf.NodeFactory.createVar("_c_");
			
			var self = this;
			var promises = _(facetConceptItems).map(function(item) {
			
				var facetConcept = item.getFacetConcept();
				
				var groupVar = facetConcept.getFacetVar();
				var countVar = facetConcept.getFacetValueVar(); 
				var elements = facetConcept.getElements();
			
				var query = ns.QueryUtils.createQueryCount(elements, null, countVar, outputVar, [groupVar], true); 
				
				var qe = self.qef.createQueryExecution(query);
				
				//qe.setTimeout()
				
				
				var promise = qe.execSelect().pipe(function(rs) {

				    // TODO Actually we don't need to store the property - we could map to
				    // the distinct value count directly
				    var nameToItem = {};
				    
				    // Initialize the result
                    _(properties).each(function(property) {
                        var propertyName = property.getUri();
                        
                        nameToItem[propertyName] = {
                            property: property,
                            distinctValueCount: 0
                        }
                    });
				    
				    // Overwrite entries based on the result set
					while(rs.hasNext()) {
						var binding = rs.nextBinding();
						
						var property = binding.get(groupVar);
						var propertyName = property.getUri();
						
						var distinctValueCount = binding.get(outputVar).getLiteralValue();
											
						nameToItem[propertyName] = {
						    property: property,
						    distinctValueCount: distinctValueCount
						}
					}

					// Create the result					
					var r = _(properties).map(function(property) {
                        var propertyName = property.getUri();
                        var item = nameToItem[propertyName];

					    var distinctValueCount = item.distinctValueCount;
					    
                        var step = new ns.Step(propertyName, isInverse);
                        var childPath = path.copyAppendStep(step);
                        var tmp = new ns.FacetItem(childPath, property, distinctValueCount);
                        return tmp
					});
					
					return r;
				});
				
				//console.log("Test: " + query);
				return promise;
			});
			
	
			var d = $.Deferred();
			$.when.apply(window, promises).done(function() {
				var r = [];
				
				for(var i = 0; i < arguments.length; ++i) {
					var items = arguments[i];
					//alert(items);
					
					r.push.apply(r, items);
				}

				d.resolve(r);
			}).fail(function() {
				d.fail();
			})

			return d.promise();
		}
	});
	
	
	
	
	// Below code needs to be ported or removed
	
	var Todo = {
	
		/**
		 * Tries to count all pages. If it fails, attempts to count the
		 * pages within the current partition
		 */
		refreshPageCount: function() {
			//console.log("Refreshing page count");

			var self = this;

			if(!this.tableExecutor) {
				self.paginatorModel.set({pageCount: 1});
				return;
			};

			var result = $.Deferred();

			//console.log('isLoading', self.tableModel.attributes);
			self.paginatorModel.set({isLoadingPageCount: true});
			
			var successAction = function(info) {				
				self.tableModel.set({
					itemCount: info.count,
					hasMoreItems: info.more
				});
				
				self.paginatorModel.set({
					isLoadingPageCount: false
				});
				
				result.resolve();
			};
				
			
			// Experiment with timeouts:
			// If the count does not return within 'timeout' seconds, we try to count again
			// with a certain threshold
			var sampleSize = 10000;
			var timeout = 3000;
			
			
			var task = this.tableExecutor.fetchResultSetSize(null, null, { timeout: timeout });
			
			
			task.fail(function() {
				
				console.log("[WARN] Timeout encountered when retrieving page count - retrying with sample strategy");
				
				var sampleTask = self.tableExecutor.fetchResultSetSize(
					sampleSize,
					null,
					{ timeout: timeout }
				); 

				sampleTask.pipe(successAction);
				
				sampleTask.fail(function() {
					console.log("[ERROR] Timout encountered during fallback sampling strategy - returning only 1 page")
					
					self.paginatorModel.set({
						isLoadingPageCount: false
					});

					result.resolve({
						itemCount: 1,
						hasMoreItems: true
					});
					
				})
				
			});
			
			
			task.pipe(successAction);
		},
		
		omfgWhatDidIDo_IWasABadProgrammer: function() {
		
			
			/*
			 * For each obtained concept, fetch the facets and facet counts  
			 */
			var promises = [];			
			for(var i = 0; i < conceptItems.length; ++i) {
				var conceptItem = conceptItems[i];
				//console.log("Fetching data for concept item: ", conceptItem);
				var promise = this.fnFetchSubFacets(this.sparqlService, conceptItem);
				promises.push(promise);
			}
			
	
			//console.log("GenericConcept: " + concept, concept.isSubjectConcept());
	
	
			var children = model.get("children");
			//var syncer = new backboneUtils.CollectionCombine(children);
	
			// Get the facets of the concept
			var tmpPromises = _.map(this.facetProviders, function(facetProvider) {
				// TODO: We do not want the facets of the concept,
				// but of the concept + constraints
				
				// This means: We need to get all constraints at the current path -
				// or more specifically: All steps.
				
				
				var tmp = facetProvider.fetchFacets(concept, false, constrainedSteps);
	
				var promise = tmp.pipe(function(items) {
	
	
					var mapped = [];
					for(var i = 0; i < items.length; ++i) {
						var item = items[i];
	
						//var mapped = _.map(items, function(item) {
	
						var facetUri = item.facetUri;
						var isInverse = item.isInverse;
	
						var step = {
							type: 'property',
							property: facetUri,
							isInverse: isInverse
						};
						
						var subFacadeNode = facetFacadeNode.forProperty(facetUri, isInverse);
						
						/*
						item = {
								facetFacadeNode: subNode,
								step: step
						};
						*/
						item.facetFacadeNode = subFacadeNode;
						item.facetNode = subFacadeNode.getFacetNode();
						item.step = step;
	
						mapped.push(item);
					}
						//console.log("Mapped model:", item);
	
						//return item;
					//});
	
					return mapped;
				});
	
				return promise;
			});
	
			model.set({
				isLoading : true
			});
	
			promises.push.apply(promises, tmpPromises);
	
			//console.log("[DEBUG] Number of promises loading " + promises.length, promises);
			
			var finalPromise = $.when.apply(null, promises);
			
			finalPromise.always(function() {
				model.set({
					isLoading : false
				});
			});
	
			
				
			var reallyFinalPromise = $.Deferred();
				
			finalPromise.pipe(function() {
				
				
				
				//console.log("Arguments: ", arguments);
				var items = [];
				for(var i = 0; i < arguments.length; ++i) {
					var args = arguments[i];
					
					items.push.apply(items, args);
				}
	
	            var itemIds = [];
	            for(var i = 0; i < items.length; ++i) {
	                var item = items[i];
	                var itemId = item.id;
	                itemIds.push(itemId);
	            }
	
	
	            // Find all children, whose ID was not yeld
	            var childIds = children.map(function(child) {
	                return child.id;
	            });
	
	
	            var removeChildIds = _.difference(childIds, itemIds);
	            children.remove(removeChildIds);
	/*
	            for(var i = 0; i < removeChildIds.length; ++i) {
	                var childId = removeChildIds
	            }
	*/
	
				for(var i = 0; i < items.length; ++i) {
					var item = items[i];
					
					var previous = children.get(item.id);
					if(previous) {
						var tmp = item;
						item = previous;
						item.set(tmp);
					} else {
						children.add(item);
					}
				}
	
				var subPromises = [];
				children.each(function(child) {
					var facetFacadeNode = child.get('facetFacadeNode');
					var subPromise = self.updateFacets(child, facetFacadeNode);
					subPromises.push(subPromise);
				});
				
				var task = $.when.apply(null, subPromises);
				
				task.done(function() {
					reallyFinalPromise.resolve();					
				}).fail(function() {
					reallyFinalPromise.fail();
				});
				
				/*
				_.each(items, function(item) {
					item.done(function(a) {
						console.log("FFS", a);
					});
				});*/
				/*
				console.log("Children", children);
				console.log("Items", items);
				for(var i = 0; i < items.length; ++i) {
					var item = items[i];
					console.log("Child[" + i + "]: ", item); // + JSON.stringify(items[i]));
				}
				children.set(items);
				console.log("New children", children);
				*/
		});
		}
	};

})(jQuery);

