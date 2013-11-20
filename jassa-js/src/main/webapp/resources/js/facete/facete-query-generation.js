(function() {

	var vocab = Jassa.vocab;
	var util = Jassa.util;
	var sparql = Jassa.sparql;
	
	var ns = Jassa.facete;


	/**
	 * Returns a single element or null
	 * 
	 * TODO A high level API based on binding objects may be better
	 */
	ns.createFilter = function(v, uriStrs, isNegated) {
		var uris = [];
		
		var nodes = uriStrs.map(function(uriStr) {
			return rdf.NodeFactory.createUri(uriStr);
		});

			
		var result = null;
		if(nodes.length > 0) {
			var expr = new sparql.E_In(new sparql.ExprVar(v), nodes);
			
			if(isNegated) {
				expr = new sparql.E_LogicalNot(expr);
			}

			result = new sparql.ElementFilter([expr]);
		}
		
		return result;
	};
	
	// TODO Move to util package
	ns.itemToArray = function(item) {
		var result = [];
		if(item != null) {
			result.push(item);
		}

		return result;
	};


	/**
	 * 
	 * 
	 * Use null or leave undefined to indicate no constraint 
	 */
	ns.LimitAndOffset = Class.create({
		initialize: function(limit, offset) {
			this.limit = limit;
			this.offset = offset;
		},
		
		getOffset: function() {
			return this.offset;
		},

		getLimit: function() {
			return this.limit;
		}		
	});

	
	ns.FacetState = Class.create({
		isOpen: function() {
			throw "Override me";
		},
		
		getResultSetRange: function() {
			throw "Override me"
		},
		
		getPartitionRange: function() {
			throw "Override me"			
		}		
	});
	
	ns.FacetStateProvider = Class.create({
		getFacetState: function(path) {
			throw "Override me";
		}
	});
	
	
	
	ns.FacetStateProviderImpl = Class.create({
		initialize: function() {
			this.pathToState = new util.HashMap();
		},
		
		getMap: function() {
			return this.pathToState;
		},
		
		getFacetState: function(path) {
			return this.pathToState.get(path);
		}
	});
	
	
	ns.FacetConceptGenerator = Class.create({
		createFacetConcept: function(path, isInverse) {
			throw "Override me";
		},

		createFacetValueConcept: function(path, isInverse) {
			throw "Override me";
		}

	});
	

	// TODO Probably it is better to just make the "dataSource" an abstraction,
	// rather than the facet concept generator.
	ns.FacetGeneratorDataProvider = Class.create({
		getRootFacetNode: function() {
			
		},
		getBaseConcept: function() {
			
		},
	});

	
	ns.FacetConceptGeneratorDirect = Class.create({
		initialize: function(baseConcept, rootFacetNode, constraintManager, facetState) {
			this.baseConcept = baseConcept;
			this.rootFacetNode = rootFacetNode;
			this.constraintManager = constraintManager;
			this.facetState = facetState;
		},
		

		/**
		 * This method signature is not final yet.
		 * 
		 */
		createFacetConceptCore: function(path, isInverse, enableOptimization) {

			var rootFacetNode = this.rootFacetNode; 
			var baseConcept = this.baseConcept;
			var constraintManager = this.constraintManager;			
			var constraintElements = constraintManager.createElements(rootFacetNode);

			var facetNode = rootFacetNode.forPath(path);
			var facetVar = facetNode.getVar();

			
			var baseElements = baseConcept.getElements();
			//baseElements.push.apply(baseElements, constraintElements);
			
			var facetElements; 
			if(baseConcept.isSubjectConcept()) {
				facetElements = constraintElements;
			} else {
				facetElements = baseElements.concat(constraintElements); 
			}
			
			var varsMentioned = sparql.PatternUtils.getVarsMentioned(facetElements); //.getVarsMentioned();
			var varNames = varsMentioned.map(function(v) { return v.getName(); });
			
			var genProperty = new sparql.GeneratorBlacklist(sparql.GenSym.create("p"), varNames);
			var genObject = new sparql.GeneratorBlacklist(sparql.GenSym.create("o"), varNames);
			
			var propertyVar = rdf.NodeFactory.createVar(genProperty.next());
			var objectVar = rdf.NodeFactory.createVar(genObject.next());
			
			// If there are no constraints, and the path points to root (i.e. is empty),
			// we can use the optimization of using the query ?s a rdf:Property
			// This makes several assumptions, TODO point to a discussion 
			// but on large datasets it may work much better than having to scan everything for the properties.
			
			var hasConstraints = facetElements.length !== 0;

			var triple; 
			
			if(enableOptimization && !hasConstraints && path.isEmpty()) {
				triple = new rdf.Triple(propertyVar, vocab.rdf.type, vocab.rdf.Property);
			} else {
				if(!isInverse) {
					triple = new rdf.Triple(facetVar, propertyVar, objectVar);
				} else {
					triple = new rdf.Triple(objectVar, propertyVar, facetVar);
				}
			}
						
			facetElements.push(new sparql.ElementTriplesBlock([triple]));
			
			
			var pathElements = facetNode.getElements();
			facetElements.push.apply(facetElements, pathElements);

			// TODO Fix the API - it should only need one call
			var finalElements = sparql.ElementUtils.flatten(facetElements);
			finalElements = sparql.ElementUtils.flattenElements(finalElements);
			
			//var result = new ns.Concept(finalElements, propertyVar);
			var result = new ns.FacetConcept(finalElements, propertyVar, objectVar);
			return result;
		},
		
		/**
		 * Creates a concept that fetches all facets at a given path
		 *
		 * Note that the returned concept does not necessarily
		 * offer access to the facet's values.
		 * 
		 * Examples:
		 * - ({?s a rdf:Property}, ?s)
		 * - ({?s a ex:Foo . ?s ?p ?o }, ?p)
		 * 
		 */
		createFacetConcept: function(path, isInverse) {
			var facetConcept = this.createFacetConceptCore(path, isInverse, true);
			
			var result = new ns.Concept(facetConcept.getElements(), facetConcept.getFacetVar());
			return result;
		},

		
		/**
		 * TODO The name is a bit confusing...
		 * 
		 * The returned concept (of type FacetConcept) holds a reference
		 * to the facet and facet value variables.
		 * 
		 * Intended use is to first obtain the set of properties, then use this
		 * method, and constraint the concept based on the obtained properties.
		 * 
		 * Examples:
		 * - ({?p a rdf:Propery . ?s ?p ?o }, ?p, ?o })
		 * - ({?s a ex:Foo . ?o ?p ?s }, ?p, ?o)
		 * 
		 * @return  
		 */
		createFacetValueConcept: function(path, isInverse) {
			var result = this.createFacetConceptCore(path, isInverse, false);
			
			return result;
		}
	});
	

	ns.FacetConceptGeneratorDelegate = Class.create(ns.FacetConceptGenerator, {
		getDelegate: function() {
			throw "Override me";
		},
		
		createFacetConcept: function(path, isInverse) {
			var delegate = this.getDelegate();
			var result = delegate.createFacetConcept(path, isInverse);
			return result;
		},

		createFacetValueConcept: function(path, isInverse) {
			var delegate = this.getDelegate();
			var result = delegate.createFacetValueConcept(path, isInverse);
			return result;
		}
	});
	

	ns.FacetConceptGeneratorIndirect = Class.create(ns.FacetConceptGeneratorDelegate, {
		initialize: function(baseConceptFactory, rootFacetNodeFactory, constraintManager, facetStateProvider) {
			this.baseConceptFactory = baseConceptFactory;
			this.rootFacetNodeFactory = rootFacetNodeFactory;
			this.constraintManager = constraintManager;
			this.facetStateProvider = facetStateProvider;
		},

		getDelegate: function() {
			var rootFacetNode = this.rootFacetNodeFactory.createFacetNode(); 
			var baseConcept = this.baseConceptFactory.createConcept();
			var constraintManager = this.constraintManager;			
			var constraintElements = constraintManager.createElements(rootFacetNode);

			var result = new ns.FacetConceptGenerator(baseConcept, rootFacetNode, constraintManager);
			
			return result;
		}
	});
		

	// TODO Rename; make more specific
	ns.createConcept = function(facetNode, constraintManager, path, includeSelfConstraints) {
		var rootNode = this.facetNode.getRootNode();
		var excludePath = includeSelfConstraints ? null : facetNode.getPath();
		
		// Create the constraint elements
		var elements = this.constraintManager.createElements(rootNode, excludePath);
		//console.log("___Constraint Elements:", elements);
		
		// Create the element for this path (if not exists)
		var pathElements = this.facetNode.getElements();
		//console.log("___Path Elements:", elements);
		
		elements.push.apply(elements, pathElements);
		
		var result = sparql.ElementUtils.flatten(elements);
		//console.log("Flattened: ", result);
		
		// Remove duplicates
		
		return result;
	};
	
	
	/**
	 * Combines the FacetConceptGenerator with a facetStateProvider
	 * in order to craft query objects.
	 * 
	 */
	ns.FacetQueryGenerator = Class.create({
		initialize: function(facetConceptFactory, facetStateProvider) {
			this.facetConceptFactory = facetConceptFactory;
			this.facetStateProvider = facetStateProvider;
		},
		
		/**
		 * Creates a query for retrieving the properties at a given path.
		 * 
		 * Applies limit and offset both for aggregation and retrieval according
		 * to the facetState for that path.
		 * 
		 * 
		 * The intended use of the querie's result set is to retrieve the facet count for each of the properties 
		 * 
		 * TODO: Which component should be responsible for retrieving all facets that match a certain keyword?
		 * 
		 * 
		 * 
		 */
		createFacetQuery: function(path, isInverse) {
			var concept = this.facetConceptFactory.createFacetConcept(path, isInverse);
			
			var facetState = facetStateProvider.getFacetState(path, isInverse);
			
			
		},
		
		
		/**
		 * Create a set of queries that yield the facet value counts
		 * for a given set of properties facing at a direction at a given path
		 * 
		 * The result looks something like this:
		 * TODO Finalize this, and create a class for it.
		 * 
		 * {
		 *    constrained: {propertyName: concept}
		 *    unconstrained: concept
		 * }
		 * 
		 * 
		 */
		createFacetValueCountQueries: function(path, isInverse, properties, isNegated) {
			
			var self = this;

			var sampleSize = null; // 50000;
			//var facetVar = sparql.Node.v("__p");
			//var countVar = sparql.Node.v("__c");
			
			var query = queryUtils.createQueryFacetCount(concept, facetVar,
					countVar, this.isInverse, sampleSize);

			//console.log("[DEBUG] Fetching facets with query: " + query);
			
			var uris = [];
			if(steps && steps.length > 0) {
				
				// Create the URIs from the steps
				for(var i = 0; i < steps.length; ++i) {
					var step = steps[i];
					
					if(step.isInverse() === this.isInverse) {
						var propertyUri = sparql.Node.uri(step.propertyName);

						uris.push(propertyUri);
					}
				}
				
				// Skip fetching if we have inclusion mode with no uris
				if(mode === true) {
					if(uris.length === 0) {
						return null;
					}
				}	

				
				if(uris.length !== 0) {
					var expr = new sparql.E_In(new sparql.ExprVar(facetVar), uris);
					
					if(!mode) {
						expr = new sparql.E_LogicalNot(expr);
					}

					var filter = new sparql.ElementFilter([expr]);

					//console.log("Filter: ", filter);
					query.elements.push(filter);
				}
			}
			
			return query;
			
			
		},
		
		
		/**
		 * Some Notes on partitioning:
		 * - TODO Somehow cache the relation between filter configuration and fetch strategy
		 * Figure out which facet steps have constraints:
		 * For each of them we have to fetch the counts individually by excluding
		 * constraints on that path			
		 * On the other hand, we can do a single query to capture all non-constrained paths
		 */
		createFacetValueCountQueries: function(path, isInverse, propertyNames, isNegated) { //(model, facetFacadeNode) {

			// TODO get access to rootFacetNode
			var facetNode = this.rootFacetNode.forPath(path);
			

			// Set up the concept for fetching facets on constrained paths
			// However make sure to filter them by the user supplied array of properties
			var tmpConstrainedSteps = this.constraintManager.getConstrainedSteps(path);
			
			var constrainedSteps = _(tmpConstrainedSteps).filter(function(step) {
				var isSameDirection = step.isInverse() === isInverse;
				if(!isSameDirection) {
					return false;
				}
				
				var isContained = _(propertyNames).contains(step.getPropertyName());
								
				var result = isNegated ? !isContained : isContained;
				return result;
			});
			
			var excludePropertyNames = constrainedSteps.map(function(step) {
				return step.getPropertyName();
			});
			
			var constrainedConceptItems = this.createConceptItems(facetNode, constrainedSteps);

			// Set up the concept for fetching facets of all concepts that were NOT constrained
			var genericConcept = facetFacadeNode.createConcept(true);
			
			
			// Combine this with the user specified array of properties 
			var filterElement = ns.createFilter(genericConcept.getVar(), excludePropertyNames, isNegated);
			if(filterElement != null) {
				genericConcept.getElements().push(filterElement);
			}
			
				
			
		},


		/**
		 * This function loads the facets of a specific concept.
		 */
		fnFetchSubFacets: function(sparqlService, conceptItem) {
	
			var facetUri = conceptItem.property;
			var concept = conceptItem.concept;
			
			var element = concept.getElement();
			var variable = concept.getVariable();
			
			var outputVar = sparql.Node.v("__c");
			var limit = null;
	
			var query = queryUtils.createQueryCount(element, null, variable, outputVar, null, true, null);
			//console.log("Fetching facets with ", query);
			var queryExecution = queryUtils.fetchInt(sparqlService, query, outputVar);
	
			
			var promise = queryExecution.pipe(function(facetCount) {
				conceptItem.facetCount = facetCount;
				//item.facetFacadeNode = subNode;
				//item.step = step;
	
				//console.log("ConceptItem: ", conceptItem);
				
				// We need to return arrays for result 
				var result = [conceptItem];
				return result;
			});
	
			return promise;
		},

	
		/**
		 * Create the list of all facets that carry constraints and
		 * for which we have to fetch their facets.
		 */
		createConceptItems: function(facetNode, constrainedSteps) {
			var self = this;
			
			var result = _(constrainedSteps).map(function(step) {
				var tmp = self.createConceptItem(facetNode, step);
				return tmp;
			});
			
			return result;
		},
		
		createConceptItem: function(facetNode, step) {
			var propertyName = step.getPropertyName();

			var targetNode = facetNode.forStep(step);
			var targetConcept = targetNode.createConcept();
			//var subNode = facetFacadeNode.forProperty(stepfacetUri.value, step.isInverse);

			var result = new ns.StepAndConcept(step, targetConcept);

//			var prefix = self.isInverse ? "<" : "";
//
//			var result = {
//				id: "simple_" + prefix + propertyName,
//				type: 'property',
//				property: propertyName,
//				isInverse: step.isInverse,
//				concept: targetConcept,
//				step: step,
//				facetFacadeNode: targetNode
//			};		
//			
			return result;
		}
	});
	
	
	ns.FacetService = Class.create({
		initialize: function() {
		}
	});
	
})();