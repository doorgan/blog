---
title: "Making sense of Elixir (improper) lists"
date: "2021-03-03"
tags:
  - elixir
---

Deep dive into Elixir lists, trying to understand improper lists from first principles.

<!-- excerpt -->

## Introduction

In Elixir, we can pattern match a list with `[head | tail] = list`, where `head` is the first element, and `tail` is a list with the rest of the elements. We can prepend to a list with a similar syntax:

```elixir
iex> list = [1, 2, 3, 4]
iex> [5 | list]
[5, 1, 2, 3, 4]
```

We can also join two lists with the `++` operator:

```elixir
iex> left = [1, 2, 3, 4]
iex> right = [5, 6, 7, 8]
iex> left ++ right
[1, 2, 3, 4, 5, 6, 7, 8]
```

But what happens when we try to _append_ to a list?

```elixir
iex> list = [1, 2, 3, 4]
iex> list ++ 5
[1, 2, 3, 4 | 5]
```

Huh. It _kind of_ worked, but there's a weird `|` symbol before the last element.
Moreover, if we try to use a function like `Enum.sum/1`, things will break:

```
iex> Enum.sum([1, 2, 3, 4 | 5])
** (FunctionClauseError) no function clause matching in Enum."-sum/1-lists^foldl/2-0-"/3
```

We get a slightly different result if we try with the `[head | tail]` syntax:

```elixir
iex> list = [1, 2, 3, 4]
iex> [list | 5]
[[1, 2, 3, 4] | 5]
```

But it's still not exactly what we want.

If we search the internets, we would probably find an answer like:

> What you see there is an improper list. (linked) Lists in elixir are made of a term and a pointer to the next element in the linked list, called a cons cell. Lists where the second element of the last cell is not the empty list is called an improper list.

The Elixir docs on lists provide a similar description:

> Similarly, we could write the list [1, 2, 3] using only such pairs (called cons cells):

```elixir
[1 | [2 | [3 | []]]]
[1, 2, 3]
```

> Some lists, called improper lists, do not have an empty list as the second element in the last cons cell:

```elixir
[1 | [2 | [3 | 4]]]
[1, 2, 3 | 4]
```

With this knowledge, we could say to ourselves that "If we want to append to a list, we need to make sure the last element is a list too", write something in the lines of `list ++ [5]` andn call it a day. So, in a nutshell, lists are linked lists, the last element of the last cell needs to be the empty list in order to be a _proper_ list, otherwise it's an _improper_ list, and most of the time you don't want improper lists.

Why does Elixir allow us to build improper lists so easily -accidentally even- if we are almost immediately told to not use them? What's their purpose?

In the following paragraphs I will try to explain the origin of lists in Erlang from it's most basic elements, some differences in the erlang and elixir terminology, and how clever usage of improper lists allows erlang to optimize the creation of data sequences that wouldn't be possible with proper lists.

## Cons cells

Many of the Erlang developers back in the day were lisp hackers, and they drew a lot of inspiration from lisps when disigning lists.

One of the most fundamental functions in lisp is `cons`: it **cons**tructs a memory object pointing to two elements. It basically builds _pair_, also known as a _cons cell_. It's used as `(cons a b)` and it's usually read as _"to cons a onto b"_, where `a` is the first element -also known as head or car- and `b` is the second element -the tail or cdr(car and cdr stand for **c**ontents of the **a**ddress part of the **r**egister and **c**ontents of the **d**ecrement part of the **r**egister, respectively). For the rest of the article I will call them `head` and `tail` respectively, which are the terms most commonly used in Elixir and Erlang.

There's a special notation for cons cells called _dotted pairs_ that represent the head and the tail more explicitly: `(a . b)`. In the same spirit, the syntax for creating a cons cell in Elixir is `[a | b]`, where the pipe `|`, commonly referred to as the _cons operator_ is akin to the dot in dotted pairs.

If you want to get the head or the tail of a cons cell, you can use the `hd/1` and
`tl/2` functions respectively:

```elixir
iex> cons = [:a | :b]
iex> hd cons
:a
iex> tl cons
:b
```

Or you could also just pattern match against it:

```elixir
iex> [head | tail] = cons
iex> head
:a
iex> tail
:b
```

This was showcased at the start of the article, but note this time we are working at a more basic level, where head and tail can be anything.

### Cons cells vs tuples

We could ask ourselves "why use cons cells when they're identical 2-tuples? Why not just have tuples?". The main difference lies in their memory layout, as explained in [BEAM VM Wisdoms](http://beam-wisdoms.clau.se/en/latest/indepth-memory-layout.htm).

On one hand, a cons cells in the heap contains two memory words pointing to the head and the tail respectively. In the case of lists the tail points to the next cons cell, which makes it easy to connect the tail of a cons cell to an existing list and reuse existing data: we just need to point the tail to another cons cell.

On the other hand, a tuple uses one word in the heap as a header and the rest of the words correspond to the tuple's elements. This allows tuples to have constant time access at an arbitraty index, but makes changing it's size a more expensive operation. Because cons cells lack a header word, they also use less memory, which may be noticeable with large lists.

A quick and dirty demonstration of this difference can be done with `:erts_debug.size/1`, which returns the size of a term in words:

```
iex> :erts_debug.size([:a |:b])
2
iex> :erts_debug.size({:a, :b})
3
```

---

In summary, cons cells are ordered pairs, and that's pretty much all there is to them. Things get more interesting when they're used to build more complex data structures.

## Lists and the empty element

We now know what cons cells are, but how do we build lists with them? If we use the `head` to hold an element of the list and make the `tail` point to the next cons cell, we should be able to build a linked list. If we were to write a typespec for it, it would look something like this: `list :: [term | list]`.

If we have the elements `1`, `2` and `3`, then `1` would point to `2` and then to `3`. We could write that as `[1 | [2 | 3]]`, but while that indeed creates a sequence, tails are required to be cons cells. There is a problem though: a cons cell is made of two elements, but we only have one at the end: the `3`. Moreover, in the above typespec there's no way to tell when the list stops as it keeps pointing to itself, infinitely. We're missing a _terminal element_ in our definition.

In lisp and functional programming jargon, this terminal element is usually called `nil`. Adding it to our typespec it would look like this: `list :: nil | [term | list]`, which reads as "A list is either the terminal element, or a cons cell where the head is any term and the tail is a list". In Erlang there's no concept of `nil` as in Elixir, in fact `nil` is just an atom in both languages. Because of this, the terminal element `nil` is represented by a pair of square brackets `[]`, and so the spec would really look like `list :: [] | [term | list]`.

The recursive nature of the data structure hints us to a recursive solution if we want to traverse it. For example, if we wanted to write a function to find an element that matches a predicate, it would look like this:
```elixir
def find([], _), do: {:error, :not_found}
def find([head | tail], predicate) do
  if predicate.(head) do
	{:ok, head}
  else
    find(tail, predicate)
  end
end
```

Note that the function headers match the two possible values for a list: a cons cell or the `nil` element(`[]`).

Funnily enough, Elixir _does_ have a concept of `nil`, which is an atom with the special property of being, in combination with the atom `false`, the only falsy values in the language. It's also used as a convention to represent the absence of a value, but this convention does not exist in Erlang.

The `[]` value is normally called _empty list_, and visually it looks like one, but in reality it's a special value whose only purpose is to be the terminal element for this kind of recursive data structures.

If you try to check that `[]` is a list, you would get a positive result:

```elixir
iex> is_list([])
true
```

That's because `[]` is one of the two possible values for a list(remember the definition: a cons cell or nil). There's a curious fact about the way `[]` works, and we can find a hint by looking at the order of the data types when sorted.

In the elixir docs we are told this:

> The reason we can compare different data types is pragmatism. Sorting algorithms don’t need to worry about different data types in order to sort. The overall sorting order is defined below:
> 
> `number < atom < reference < function < port < pid < tuple < map < list < bitstring`

So far we don't see anything weird: `list` is the only list type mentioned, so we could think that `[]` is indeed a list, nothing seems to say the opposite.
However, if we look at the same explanation but in the Erlang docs:

> The following order is defined:
> 
> `number < atom < reference < fun < port < pid < tuple < map < nil < list < bit string`

There's a subtle difference: there's an additional type, `nil`, that's listed as a separate type from `list`. The docs further explain:

> nil in the previous expression represents the empty list ([]), which is regarded as a separate type from list/0. That is why nil < list.

Even more interesting is the fact that there exists a dedicated opcode in the BEAM to check for `nil`, as shown in the [BEAM Instructions](http://beam-wisdoms.clau.se/en/latest/indepth-beam-instructions.html) section of BEAM VM Wisdoms, and also showcased by [Isaac Yonemoto](https://twitter.com/DNAutics) in his [is_nil BEAM opcode for Elixirists](https://www.youtube.com/watch?v=nebDOqU0TJ0) video.

This is a minor detail, really, but I find it interesting because it's one of those cases where Erlang and Elixir differ in their terminology: `nil` means completely different things for each language.

---

Let's remind ourselves the lists type: `list :: [] | [term | list]`.

Based on this, our list with the elements `1`, `2` and `3` would be written as `[1 | [2 | [3 | []]]]`, and we arrived at the same expression showcased by the docs. Of course, manually writing lists as a succession of cons cells is cumbersome and prone to errors, so usually an alternative syntax is provided to build lists: `[1, 2, 3]`. This is the syntax we're used to and use every day.

But since lists are a essentially nested cons cells, nothing stops us from creating `[1 | [2 | 3]]`(or `[1, 2 | 3]` like we did before. That's a perfectly valid data structure, it's just not a list as we defined it, it lacks the terminal element `[]` at the end of the chain, and so it receives the name of _improper_ list.

### Improper lists

So, improper lists are just lists that lack the `[]` as a tail for their last cons cell. We could even argue that improper lists are any combination of cons cells that are not a list. For example, `[[1 | 2] | 3]` is an improper list, but it's also a representation of the following binary tree:
```
   *
  / \
 *   3
/ \
1 2
```

When we use the `++` operator, replaces the terminal element of the left hand side with the value of the right hand side. If we have the list `[1, 2]`, that is `[1 | [2 | []]]` written as cons cells, and we want to append `[3, 4]` to it, what happens when you do `[1, 2] ++ [3, 4]` is that the `[]` in `[2 | []]` get's replaced by `[3, 4]`, resulting in the list `[1, 2, 3, 4]`(remember how we said cons cells make it easy to connect the tail of a cons cell to an existing list?). To do this, the entire list at the left hand side needs to be traversed until the end, so appends will have a linear time complexity.

Prepending to a list is even easier, as we just need to create a new cons cell that points to an existing list:
```elixir
iex> list = [1, 2, 3]
iex> [0 | list]
[0, 1, 2, 3]
```
Cons cells creation is done in constant time, so this is the reason why people say prepending to a linked list is faster.

If we try to append `3` to `[1, 2]`, doing `[1, 2] ++ 3` will return `[1, 2 | 3]`; the `[]` was replaced by `3`, thus turning it into an improper list, as hinted by the `|` at the end. In general, whenever you see the pipe at the end of a list it means you've done something wrong and accidentally created an improper list.
The reason why you need to wrap a value in a list before appending it to another list, ie: `[1, 2] ++ [3]` should be clearer now.

## Improper lists as an optimization technique

We've already seen what makes a list(cons cells and the terminal element), and have discussed a little bit about the properties of two of their most common operations: append and prepend.

We said that appending to a linked list has linear time complexity. This means that the larger the list, the more it takes to append an element to it, or to join two lists together. If we need to append a large ammount of items, one by one, to a list, we would be in trouble.

Let's say we're building a large list by appending elements to it to write to a file or any other kind of IO operation. For the sake of demonstration we'll just use a sequence of strings, essentially rebuilding the list we were given as input, but in real life this would be some non trivial data, like the results of compiling a phoenix template.

A first approximation would be:
```elixir
Enum.reduce(~w[a b c d e f], [], fn n, acc ->
  acc ++ [n]
end)
["a", "b", ...]
```

However, we're traversing the whole accumulator in each iteration. We could do better by building the list in reverse and correcting the ordering afterwards:
```elixir
Enum.reduce(~w[a b c d e f], [], fn n, acc ->
  [n | acc]
end)
|> Enum.reverse()
["a", "b", ...]
```
However, this would still be slow for very large lists.

Luckily, there's a clever trick we can use by taking advantage of improper lists. Remember that lists are basically nested cons cells, and that the creation of cons cells happens in constant time. We could exploit this fact by consing the new elements at the tail instead of the head:
```elixir
Enum.reduce(~w[a b c d e f], [], fn n, acc ->
  [acc | n]
end)
[[[["a"] | "b"] | "c"] | ... ]
```

Of course this is no longer a proper list and we end up with a funny nesting at the head of the cons cells, but we're able to append elements in constant time!

We can also prepend to this improper list in constant time:
```elixir
["zzz" | [[["a"] | "b"] | "c"]]
```

When we have this kind of combination of cons cells, where the terminals are either printable ASCII codepoints and binaries, with arbitraty nesting, we have what's known as an IO List. At first they may seem like a lot of gibberish, with lots of nesting and hard to traverse. In most cases this is true, but when you need to join a large number of binaries where there may also be a lot of repetition, this technique has huge benefits. Moreover, many of the lower level erlang functions know how to handle iolists, so the nesting isn't an issue.

For instance the above io list can be printed as a binary by doing:
```elixir
iex> :erlang.iolist_to_binary ["zzz" | [[["a"] | "b"] | "c"]]
"zzzabc"
```

There's an article by Evan Miller called [Elixir RAM and the Template of DOOM](https://www.evanmiller.org/elixir-ram-and-the-template-of-doom.html) that does a really good job on demonstrating the issues with concatenating lots of repeated data and how IO lists can greatly increase performance in those cases.

## Summary

Lists, both proper and improper, are made of two basic types in the BEAM: cons cells and nil/empty list. Proper lists are a special arrangement of these two types where the tail of the cons cells point to another cons cell or the empty list. Every other case is considered an improper list. `[a | b]` is the syntax for a cons cell, and we can use it to pattern match against lists, or to prepend elements to a list.

When appending to lists with the `++` operator, we have to make sure that the right hand side is also a list, otherwise we will accidentally create an improper lists. Despite of this minor annoyance, improper lists are a very important data structure in the BEAM, and we can see them in action in the creation of IO Lists.

At the end of the day, most of the details explained in this article aren't needed for your day to day Elixir coding, but I hope this knowledge will provide you with a more solid understanding of the language constructs, so the next time you see the `|` in your lists you will know how to *proper*ly read it.

## References
- [Elixir docs: List](https://hexdocs.pm/elixir/List.html)
- [Cons - Wikipedia](https://en.wikipedia.org/wiki/Cons)
- [Elixir term ordering](https://hexdocs.pm/elixir/master/operators.html#term-ordering)
- [Erlang term comparisons](https://erlang.org/doc/reference_manual/expressions.html#term-comparisons)
- [Data Types Memory Layout](http://beam-wisdoms.clau.se/en/latest/indepth-memory-layout.html)
- [is_nil BEAM opcode for Elixirists](https://www.youtube.com/watch?v=nebDOqU0TJ0)
- [BEAM Instruction codes](http://beam-wisdoms.clau.se/en/latest/indepth-beam-instructions.html)
- [James Edward Gray II on using improper lists to quickly append elements](https://elixirforum.com/t/weird-sasl-lists-and-can-i-rely-on-kernel-is-list/470/7)
- [Elixir RAM and the Template of DOOM](https://www.evanmiller.org/elixir-ram-and-the-template-of-doom.html)
